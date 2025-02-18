import { useRef, useState, useEffect, useContext, useLayoutEffect } from "react";
import { CommandBarButton, IconButton, Dialog, DialogType, Stack } from "@fluentui/react";
import { DismissRegular, SquareRegular, ShieldLockRegular, ErrorCircleRegular } from "@fluentui/react-icons";

import ReactMarkdown from "react-markdown";
import remarkGfm from 'remark-gfm'
import rehypeRaw from "rehype-raw";
import uuid from 'react-uuid';
import { isEmpty } from "lodash-es";

import styles from "./Chat.module.css";
import Logo from "../../assets/logo-center.png";

import {
    ChatMessage,
    ConversationRequest,
    conversationApi,
    Citation,
    ToolMessageContent,
    ChatResponse,
    getUserInfo,
    Conversation,
    historyGenerate,
    historyUpdate,
    historyClear,
    ChatHistoryLoadingState,
    CosmosDBStatus,
    ErrorMessage,
    dalleApi
} from "../../api";
import { Answer } from "../../components/Answer";
import { QuestionInput } from "../../components/QuestionInput";
import { ChatHistoryPanel } from "../../components/ChatHistory/ChatHistoryPanel";
import { AppStateContext } from "../../state/AppProvider";
import { useBoolean } from "@fluentui/react-hooks";
import { ModelType } from "../../api/models";

const enum messageStatus {
    NotRunning = "Not Running",
    Processing = "Processing",
    Done = "Done"
}

const Chat = () => {
    const lastQuestionRef = useRef<string>("");
    const appStateContext = useContext(AppStateContext)
    const modelRef = useRef<ModelType>(ModelType.GPT_4);
    const chatMessageStreamEnd = useRef<HTMLDivElement | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isFetchingHistory, setIsFetchingHistory] = useState<boolean>(false);
    const [showLoadingMessage, setShowLoadingMessage] = useState<boolean>(false);
    const [activeCitation, setActiveCitation] = useState<Citation>();
    const [isCitationPanelOpen, setIsCitationPanelOpen] = useState<boolean>(false);
    const abortFuncs = useRef([] as AbortController[]);
    const [showAuthMessage, setShowAuthMessage] = useState<boolean>(true);
    const [answers, setAnswers] = useState<ChatMessage[]>([]);
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [processMessages, setProcessMessages] = useState<messageStatus>(messageStatus.NotRunning);
    const [clearingChat, setClearingChat] = useState<boolean>(false);
    const [hideErrorDialog, { toggle: toggleErrorDialog }] = useBoolean(true);
    const [error, setError] = useState<unknown>();
    const [errorMsg, setErrorMsg] = useState<ErrorMessage | null>()

    const errorDialogContentProps = {
        type: DialogType.close,
        title: errorMsg?.title,
        closeButtonAriaLabel: 'Close',
        subText: errorMsg?.subtitle,
    };

    const modalProps = {
        titleAriaId: 'labelId',
        subtitleAriaId: 'subTextId',
        isBlocking: true,
        styles: { main: { maxWidth: 450 } },
    }

    const [ASSISTANT, TOOL, ERROR] = ["assistant", "tool", "error"]

    useEffect(() => {
        console.log(messages)
    }, [messages])

    useEffect(() => {
        if(appStateContext?.state.isCosmosDBAvailable?.status === CosmosDBStatus.NotWorking && appStateContext.state.chatHistoryLoadingState === ChatHistoryLoadingState.Fail && hideErrorDialog){
            let subtitle = `${appStateContext.state.isCosmosDBAvailable.status}. Please contact the site administrator.`
            setErrorMsg({
                title: "Chat history is not enabled",
                subtitle: subtitle
            })
            toggleErrorDialog();
        }
    }, [appStateContext?.state.isCosmosDBAvailable]);

    const handleErrorDialogClose = () => {
        toggleErrorDialog()
        setTimeout(() => {
            setErrorMsg(null)
        }, 500);
    }

    useEffect(() => {
       setIsFetchingHistory(appStateContext?.state.chatHistoryLoadingState === ChatHistoryLoadingState.Loading)
    }, [appStateContext?.state.chatHistoryLoadingState])

    const getUserInfoList = async () => {
        const userInfoList = await getUserInfo();
        if (userInfoList.length === 0 && window.location.hostname !== "127.0.0.1") {
            setShowAuthMessage(true);
        }
        else {
            setShowAuthMessage(false);
        }
    }

    let assistantMessage = {} as ChatMessage
    let toolMessage = {} as ChatMessage
    let assistantContent = ""

    const processResultMessage = (resultMessage: ChatMessage, userMessage: ChatMessage, conversationId?: string) => {
        if (resultMessage.role === ASSISTANT) {
            assistantContent += resultMessage.content
            assistantMessage = resultMessage
            assistantMessage.content = assistantContent
        }

        if (resultMessage.role === TOOL) toolMessage = resultMessage

        if (!conversationId) {
            isEmpty(toolMessage) ?
                setMessages([...messages, userMessage, assistantMessage]) :
                setMessages([...messages, userMessage, toolMessage, assistantMessage]);
        } else {
            isEmpty(toolMessage) ?
                setMessages([...messages, assistantMessage]) :
                setMessages([...messages, toolMessage, assistantMessage]);
        }
    }

    const makeApiRequestWithoutCosmosDB = async (question: string) => {
        lastQuestionRef.current = question;

        setIsLoading(true);
        error && setError(undefined);
        setShowLoadingMessage(true);
        const abortController = new AbortController();
        abortFuncs.current.unshift(abortController);

        const userMessage: ChatMessage = {
            role: "user",
            content: question,
            id: uuid(),
        };

        const request: ConversationRequest = {
            //messages: [...answers, userMessage]
            messages: messages.slice(-6).concat(userMessage)
            //messages: [...context, userMessage]
        };
        setMessages(request.messages)

        let result = {} as ChatResponse;
        let response;
        try {
            response = await dalleApi(request, abortController.signal);
            if (response?.body) {
                
                const reader = response.body.getReader();
                let runningText = "";
                while (true) {
                    const {done, value} = await reader.read();
                    if (done) break;

                    var text = new TextDecoder("utf-8").decode(value);
                    const objects = text.split("\n");
                    objects.forEach((obj) => {
                        try {
                            runningText += obj;
                            result = JSON.parse(runningText);
                            setShowLoadingMessage(false);
                            if (result?.choices) {
                                setMessages([...messages, userMessage, ...result.choices[0].messages]);
                            }
                            runningText = "";
                        }
                        catch { }
                    });
                }
                if (result?.choices) {
                    setMessages([...messages, userMessage, ...result.choices[0].messages]);
                }
                else if (result?.image_url) {
                    const imageMessage: ChatMessage = {
                        role: 'image',
                        content: result.image_url,
                        id: uuid()
                    };
                    setMessages([...messages, userMessage, imageMessage]);
                }
                else if (result?.error) {
                    const safetyPattern: RegExp = /safety system/;
                    const errorMessage: ChatMessage = {
                        role: 'assistant',
                        content: safetyPattern.test(result.error) ? 
                            "The task failed as a result of our safety system. This is an experimental feature of IDSGPT " + 
                            "and the system may have incorrectly rejected your request. Please try again."
                            :
                            "Sorry, answer generation has failed. " + result.error
                    }
                    setMessages([...messages, userMessage, errorMessage]);
                }
            }
            
        } catch ( e )  {
            if (!abortController.signal.aborted) {
                console.error(e);
                console.error(result);
                if(response && response.status === 408){
                    setError("Timed out, Please try again");
                }
                else if(response && response.status === 400){
                    const lengthPattern: RegExp = /Please reduce the length/;
                    let message = result.error ? result.error : ""
                    if (lengthPattern.test(message)) {
                        setError("Please reduce the length of the messages.");
                    }
                    else{
                    alert("An error occurred. Please try again. If the problem persists, please contact the site administrator.")
                    }
                }
                else{
                alert("An error occurred. Please try again. If the problem persists, please contact the site administrator.")
                }
            }
            setMessages([...messages, userMessage]);
        } finally {
            setIsLoading(false);
            setShowLoadingMessage(false);
            abortFuncs.current = abortFuncs.current.filter(a => a !== abortController);
        }

        return abortController.abort();
    };


    const makeApiRequestWithCosmosDB = async (question: string, conversationId?: string) => {
        setIsLoading(true);
        setShowLoadingMessage(true);
        const abortController = new AbortController();
        abortFuncs.current.unshift(abortController);

        const userMessage: ChatMessage = {
            id: uuid(),
            role: "user",
            content: question,
            date: new Date().toISOString(),
        };

        //api call params set here (generate)
        let request: ConversationRequest;
        let conversation;
        if(conversationId){
            conversation = appStateContext?.state?.chatHistory?.find((conv) => conv.id === conversationId)
            if(!conversation){
                console.error("Conversation not found.");
                setIsLoading(false);
                setShowLoadingMessage(false);
                abortFuncs.current = abortFuncs.current.filter(a => a !== abortController);
                return;
            }else{
                conversation.messages.push(userMessage);
                request = {
                    messages: [...conversation.messages.filter((answer) => answer.role !== ERROR)]
                };
            }
        }else{
            request = {
                messages: [userMessage].filter((answer) => answer.role !== ERROR)
            };
            setMessages(request.messages)
        }
        let result = {} as ChatResponse;
        try {
            const response = conversationId ? await historyGenerate(request, abortController.signal, conversationId) : await historyGenerate(request, abortController.signal);
            if(!response?.ok){
                let errorChatMsg: ChatMessage = {
                    id: uuid(),
                    role: ERROR,
                    content: "There was an error generating a response. Chat history can't be saved at this time. If the problem persists, please contact the site administrator.",
                    date: new Date().toISOString()
                }
                let resultConversation;
                if(conversationId){
                    resultConversation = appStateContext?.state?.chatHistory?.find((conv) => conv.id === conversationId)
                    if(!resultConversation){
                        console.error("Conversation not found.");
                        setIsLoading(false);
                        setShowLoadingMessage(false);
                        abortFuncs.current = abortFuncs.current.filter(a => a !== abortController);
                        return;
                    }
                    resultConversation.messages.push(errorChatMsg);
                }else{
                    setMessages([...messages, userMessage, errorChatMsg])
                    setIsLoading(false);
                    setShowLoadingMessage(false);
                    abortFuncs.current = abortFuncs.current.filter(a => a !== abortController);
                    return;
                }
                appStateContext?.dispatch({ type: 'UPDATE_CURRENT_CHAT', payload: resultConversation });
                setMessages([...resultConversation.messages]);
                return;
            }
            if (response?.body) {
                const reader = response.body.getReader();
                let runningText = "";

                while (true) {
                    setProcessMessages(messageStatus.Processing)
                    const {done, value} = await reader.read();
                    if (done) break;

                    var text = new TextDecoder("utf-8").decode(value);
                    const objects = text.split("\n");
                    objects.forEach((obj) => {
                        try {
                            runningText += obj;
                            result = JSON.parse(runningText);
                            result.choices[0].messages.forEach((obj) => {
                                obj.id = uuid();
                                obj.date = new Date().toISOString();
                            })
                            setShowLoadingMessage(false);
                            result.choices[0].messages.forEach((resultObj) => {
                                processResultMessage(resultObj, userMessage, conversationId);
                            })
                            runningText = "";
                        }
                        catch { }
                    });
                }

                let resultConversation;
                if(conversationId){
                    resultConversation = appStateContext?.state?.chatHistory?.find((conv) => conv.id === conversationId)
                    if(!resultConversation){
                        console.error("Conversation not found.");
                        setIsLoading(false);
                        setShowLoadingMessage(false);
                        abortFuncs.current = abortFuncs.current.filter(a => a !== abortController);
                        return;
                    }
                    isEmpty(toolMessage) ?
                        resultConversation.messages.push(assistantMessage) :
                        resultConversation.messages.push(toolMessage, assistantMessage)
                }else{
                    resultConversation = {
                        id: result.history_metadata.conversation_id,
                        title: result.history_metadata.title,
                        messages: [userMessage],
                        date: result.history_metadata.date
                    }
                    isEmpty(toolMessage) ?
                        resultConversation.messages.push(assistantMessage) :
                        resultConversation.messages.push(toolMessage, assistantMessage)
                }
                if(!resultConversation){
                    setIsLoading(false);
                    setShowLoadingMessage(false);
                    abortFuncs.current = abortFuncs.current.filter(a => a !== abortController);
                    return;
                }
                appStateContext?.dispatch({ type: 'UPDATE_CURRENT_CHAT', payload: resultConversation });
                isEmpty(toolMessage) ?
                    setMessages([...messages, assistantMessage]) :
                    setMessages([...messages, toolMessage, assistantMessage]);     
            }
            
        } catch ( e )  {
            if (!abortController.signal.aborted) {
                let errorMessage = "An error occurred. Please try again. If the problem persists, please contact the site administrator.";
                if (result.error?.message) {
                    errorMessage = result.error.message;
                }
                else if (typeof result.error === "string") {
                    errorMessage = result.error;
                }
                let errorChatMsg: ChatMessage = {
                    id: uuid(),
                    role: ERROR,
                    content: errorMessage,
                    date: new Date().toISOString()
                }
                let resultConversation;
                if(conversationId){
                    resultConversation = appStateContext?.state?.chatHistory?.find((conv) => conv.id === conversationId)
                    if(!resultConversation){
                        console.error("Conversation not found.");
                        setIsLoading(false);
                        setShowLoadingMessage(false);
                        abortFuncs.current = abortFuncs.current.filter(a => a !== abortController);
                        return;
                    }
                    resultConversation.messages.push(errorChatMsg);
                }else{
                    if(!result.history_metadata){
                        console.error("Error retrieving data.", result);
                        setIsLoading(false);
                        setShowLoadingMessage(false);
                        abortFuncs.current = abortFuncs.current.filter(a => a !== abortController);
                        return;
                    }
                    resultConversation = {
                        id: result.history_metadata.conversation_id,
                        title: result.history_metadata.title,
                        messages: [userMessage],
                        date: result.history_metadata.date
                    }
                    resultConversation.messages.push(errorChatMsg);
                }
                if(!resultConversation){
                    setIsLoading(false);
                    setShowLoadingMessage(false);
                    abortFuncs.current = abortFuncs.current.filter(a => a !== abortController);
                    return;
                }
                appStateContext?.dispatch({ type: 'UPDATE_CURRENT_CHAT', payload: resultConversation });
                setMessages([...messages, errorChatMsg]);
            } else {
                setMessages([...messages, userMessage])
            }
        } finally {
            setIsLoading(false);
            setShowLoadingMessage(false);
            abortFuncs.current = abortFuncs.current.filter(a => a !== abortController);
            setProcessMessages(messageStatus.Done)
        }
        return abortController.abort();

    }

    const clearChat = async () => {
        setClearingChat(true)
        if(appStateContext?.state.currentChat?.id && appStateContext?.state.isCosmosDBAvailable.cosmosDB){
            let response = await historyClear(appStateContext?.state.currentChat.id)
            if(!response.ok){
                setErrorMsg({
                    title: "Error clearing current chat",
                    subtitle: "Please try again. If the problem persists, please contact the site administrator.",
                })
                toggleErrorDialog();
            }else{
                appStateContext?.dispatch({ type: 'DELETE_CURRENT_CHAT_MESSAGES', payload: appStateContext?.state.currentChat.id});
                appStateContext?.dispatch({ type: 'UPDATE_CHAT_HISTORY', payload: appStateContext?.state.currentChat});
                setActiveCitation(undefined);
                setIsCitationPanelOpen(false);
                setMessages([])
            }
        }
        setClearingChat(false)
    };

    const newChat = () => {
        setProcessMessages(messageStatus.Processing)
        setMessages([])
        setIsCitationPanelOpen(false);
        setActiveCitation(undefined);
        appStateContext?.dispatch({ type: 'UPDATE_CURRENT_CHAT', payload: null });
        setProcessMessages(messageStatus.Done)
    };

    const stopGenerating = () => {
        abortFuncs.current.forEach(a => a.abort());
        setShowLoadingMessage(false);
        setIsLoading(false);
    }

    useEffect(() => {
        if (appStateContext?.state.currentChat) {
            setMessages(appStateContext.state.currentChat.messages)
        }else{
            setMessages([])
        }
    }, [appStateContext?.state.currentChat]);
    
    useLayoutEffect(() => {
        const saveToDB = async (messages: ChatMessage[], id: string) => {
            const response = await historyUpdate(messages, id)
            return response
        }

        if (appStateContext && appStateContext.state.currentChat && processMessages === messageStatus.Done) {
                if(appStateContext.state.isCosmosDBAvailable.cosmosDB){
                    if(!appStateContext?.state.currentChat?.messages){
                        console.error("Failure fetching current chat state.")
                        return 
                    }
                    saveToDB(appStateContext.state.currentChat.messages, appStateContext.state.currentChat.id)
                    .then((res) => {
                        if(!res.ok){
                            let errorMessage = "An error occurred. Answers can't be saved at this time. If the problem persists, please contact the site administrator.";
                            let errorChatMsg: ChatMessage = {
                                id: uuid(),
                                role: ERROR,
                                content: errorMessage,
                                date: new Date().toISOString()
                            }
                            if(!appStateContext?.state.currentChat?.messages){
                                let err: Error = {
                                    ...new Error,
                                    message: "Failure fetching current chat state."
                                }
                                throw err
                            }
                            setMessages([...appStateContext?.state.currentChat?.messages, errorChatMsg])
                        }
                        return res as Response
                    })
                    .catch((err) => {
                        console.error("Error: ", err)
                        let errRes: Response = {
                            ...new Response,
                            ok: false,
                            status: 500,
                        }
                        return errRes;
                    })
                }else{
                }
                appStateContext?.dispatch({ type: 'UPDATE_CHAT_HISTORY', payload: appStateContext.state.currentChat });
                setMessages(appStateContext.state.currentChat.messages)
            setProcessMessages(messageStatus.NotRunning)
        }
    }, [processMessages]);

    useEffect(() => {
        getUserInfoList();
    }, []);

    useLayoutEffect(() => {
        chatMessageStreamEnd.current?.scrollIntoView({ behavior: "smooth" })
    }, [showLoadingMessage, processMessages]);

    const onShowCitation = (citation: Citation) => {
        setActiveCitation(citation);
        setIsCitationPanelOpen(true);
    };

    const onViewSource = (citation: Citation) => {
        if (citation.url && !citation.url.includes("blob.core")) {
            window.open(citation.url, "_blank");
        }
    };

    const parseCitationFromMessage = (message: ChatMessage) => {
        if (message?.role && message?.role === "tool") {
            try {
                const toolMessage = JSON.parse(message.content) as ToolMessageContent;
                return toolMessage.citations;
            }
            catch {
                return [];
            }
        }
        return [];
    }

    const disabledButton = () => {
        return isLoading || (messages && messages.length === 0) || clearingChat || appStateContext?.state.chatHistoryLoadingState === ChatHistoryLoadingState.Loading
    }

    return (
        <div className={styles.container} role="main">
                <Stack horizontal className={styles.chatRoot}>
                    <div className={styles.chatContainer}>
                        {!messages || messages.length < 1 ? (
                            <Stack className={styles.chatEmptyState}>
                            <img
                                src={Logo}
                                className={styles.chatIcon}
                                aria-hidden="true"
                            />
                            <h1 className={styles.chatEmptyStateTitle}>CBI Private ChatGPT</h1>
                            <p className={styles.chatInput}><span>Please refer to the <a href="https://cbrands--c.vf.force.com/apex/CBI_ContentSearch?contentId=a1BG0000003XU2DMAW&type=POLICIES&category=IT&sortBy=lastModifiedDate&sortOrder=desc">Generative Artificial Intelligence Policy</a> for guidance on approved usage of Generative AI platforms and your responsibilities to ensure the protection of our intellectual property. Generative AI is an exciting and fast-moving technology that will enhance the way we work but does come with risk, the policy is intended to provide guidance to help minimize those risks, while allowing us to take advantage of the emerging capabilities. To that end, please note that the <b>new text-to-image functionality utilizing DALL-E 3 is a preview</b>, and only offers a glimpse into its capabilities at this time.</span>
                            <br /><br /><span>We encourage you to utilize the feedback button at the top of the page with any thoughts or suggestions as we continue to work on enhancing IDSGPT.</span>
                            </p>
                        </Stack>
                    ) : (
                            <div className={styles.chatMessageStream} style={{ marginBottom: isLoading ? "40px" : "0px"}} role="log">
                                {messages.map((answer, index) => (
                                    <>
                                        {answer.role === "user" ? (
                                            <div className={styles.chatMessageUser} tabIndex={0}>
                                                <div className={styles.chatMessageUserMessage}>{answer.content}</div>
                                            </div>
                                        ) : (
                                            answer.role === "assistant" ? <div className={styles.chatMessageGpt}>
                                                <Answer
                                                    answer={{
                                                        answer: answer.content,
                                                        citations: parseCitationFromMessage(messages[index - 1]),
                                                    }}
                                                    onCitationClicked={c => onShowCitation(c)}
                                                />
                                            </div> : answer.role === ERROR ? <div className={styles.chatMessageError}>
                                                <Stack horizontal className={styles.chatMessageErrorContent}>
                                                    <ErrorCircleRegular className={styles.errorIcon} style={{color: "rgba(182, 52, 67, 1)"}} />
                                                    <span>Error</span>
                                                </Stack>
                                                <span className={styles.chatMessageErrorContent}>{answer.content}</span>
                                            </div>
                                        : (
                                            answer.role === "image" ? (
                                                <div className={styles.chatMessageImage}>
                                                    <img src={answer.content} alt="Image" />
                                                </div>
                                            ) : null
                                        )
                                    )}
                                    </>
                                ))}
                                {showLoadingMessage && (
                                    <>
                                        <div className={styles.chatMessageGpt}>
                                            <Answer
                                                answer={{
                                                    answer: "Generating answer...",
                                                    citations: []
                                                }}
                                                onCitationClicked={() => null}
                                            />
                                        </div>
                                    </>
                                )}
                                <div ref={chatMessageStreamEnd} />
                            </div>
                        )}

                        <Stack horizontal className={styles.chatInput}>
                            {isFetchingHistory && (
                                    <Stack 
                                        horizontal
                                        className={styles.stopGeneratingContainer}
                                        role="button"
                                        aria-label="Loading History"
                                        tabIndex={0}
                                        >
                                            <span className={styles.stopGeneratingText} aria-hidden="true">Loading History</span>
                                    </Stack>
                            )}
                            {isLoading && (
                                <Stack 
                                    horizontal
                                    className={styles.stopGeneratingContainer}
                                    role="button"
                                    aria-label="Stop generating"
                                    tabIndex={0}
                                    onClick={stopGenerating}
                                    onKeyDown={e => e.key === "Enter" || e.key === " " ? stopGenerating() : null}
                                    >
                                        <SquareRegular className={styles.stopGeneratingIcon} aria-hidden="true"/>
                                        <span className={styles.stopGeneratingText} aria-hidden="true">Stop generating</span>
                                </Stack>
                            )}
\                            <Stack>
                                {appStateContext?.state.isCosmosDBAvailable?.status !== CosmosDBStatus.NotConfigured && <CommandBarButton
                                    role="button"
                                    styles={{ 
                                        icon: { 
                                            color: '#FFFFFF',
                                        },
                                        root: {
                                            color: '#FFFFFF',
                                            background: "radial-gradient(109.81% 107.82% at 100.1% 90.19%, #0F6CBD 33.63%, #2D87C3 70.31%, #8DDDD8 100%)"
                                        },
                                        rootDisabled: {
                                            background: "#BDBDBD"
                                        }
                                    }}
                                    className={styles.newChatIcon}
                                    iconProps={{ iconName: 'Add' }}
                                    onClick={newChat}
                                    disabled={disabledButton()}
                                    aria-label="start a new chat button"
                                />}
                                <CommandBarButton
                                    role="button"
                                    styles={{ 
                                        icon: { 
                                            color: '#FFFFFF',
                                        },
                                        root: {
                                            color: '#FFFFFF',
                                            background: disabledButton() ? "#BDBDBD" : "radial-gradient(109.81% 107.82% at 100.1% 90.19%, #0F6CBD 33.63%, #2D87C3 70.31%, #8DDDD8 100%)",
                                            cursor: disabledButton() ? "" : "pointer"
                                        },
                                    }}
                                    className={appStateContext?.state.isCosmosDBAvailable?.status !== CosmosDBStatus.NotConfigured ? styles.clearChatBroom : styles.clearChatBroomNoCosmos}
                                    iconProps={{ iconName: 'Broom' }}
                                    onClick={appStateContext?.state.isCosmosDBAvailable?.status !== CosmosDBStatus.NotConfigured ? clearChat : newChat}
                                    disabled={disabledButton()}
                                    aria-label="clear chat button"
                                />
                                <Dialog
                                    hidden={hideErrorDialog}
                                    onDismiss={handleErrorDialogClose}
                                    dialogContentProps={errorDialogContentProps}
                                    modalProps={modalProps}
                                >
                                </Dialog>
                            </Stack>
                            <QuestionInput
                                clearOnSend
                                placeholder="Type a new question..."
                                disabled={isLoading}
                                onSend={(question, id?, model?: ModelType) => {
                                    if (appStateContext?.state.isCosmosDBAvailable?.cosmosDB && model == "GPT 4") {
                                        makeApiRequestWithCosmosDB(question, id)
                                    } else {
                                        makeApiRequestWithoutCosmosDB(question)
                                    }
                                }}
                                conversationId={appStateContext?.state.currentChat?.id ? appStateContext?.state.currentChat?.id : undefined}
                            />
                        </Stack>
                    </div>
                    {/* Citation Panel */}
                    {messages && messages.length > 0 && isCitationPanelOpen && activeCitation && ( 
                    <Stack.Item className={styles.citationPanel} tabIndex={0} role="tabpanel" aria-label="Citations Panel">
                        <Stack aria-label="Citations Panel Header Container" horizontal className={styles.citationPanelHeaderContainer} horizontalAlign="space-between" verticalAlign="center">
                            <span aria-label="Citations" className={styles.citationPanelHeader}>Citations</span>
                            <IconButton iconProps={{ iconName: 'Cancel'}} aria-label="Close citations panel" onClick={() => setIsCitationPanelOpen(false)}/>
                        </Stack>
                        <h5 className={styles.citationPanelTitle} tabIndex={0} title={activeCitation.url && !activeCitation.url.includes("blob.core") ? activeCitation.url : activeCitation.title ?? ""} onClick={() => onViewSource(activeCitation)}>{activeCitation.title}</h5>
                        <div tabIndex={0}> 
                        <ReactMarkdown 
                            linkTarget="_blank"
                            className={styles.citationPanelContent}
                            children={activeCitation.content} 
                            remarkPlugins={[remarkGfm]} 
                            rehypePlugins={[rehypeRaw]}
                        />
                        </div>
                    </Stack.Item>
                )}
                {(appStateContext?.state.isChatHistoryOpen && appStateContext?.state.isCosmosDBAvailable?.status !== CosmosDBStatus.NotConfigured) && <ChatHistoryPanel/>}
                </Stack>
        </div>
    );
};

export default Chat;
