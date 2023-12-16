import { useState } from "react";
import { Dropdown, IDropdownOption, Stack, TextField } from "@fluentui/react";
import { SendRegular } from "@fluentui/react-icons";
import Send from "../../assets/Send.svg";
import styles from "./QuestionInput.module.css";
import { ModelType } from "../../api/models";

interface Props {
    onSend: (question: string, id?: string, model?: ModelType) => void;
    disabled: boolean;
    placeholder?: string;
    clearOnSend?: boolean;
    conversationId?: string;
}

export const QuestionInput = ({ onSend, disabled, placeholder, clearOnSend, conversationId }: Props) => {
    const [question, setQuestion] = useState<string>("");

    const modelOptions = [
        { key: ModelType.GPT_4, text: ModelType.GPT_4.valueOf() },
        { key: ModelType.DALL_E_3, text: ModelType.DALL_E_3.valueOf() }
    ]

    const [selectedModel, setSelectedModel] = useState<IDropdownOption | undefined>(modelOptions[0]);

    const onModelChange = (_ev: React.FormEvent<HTMLDivElement>, option?: IDropdownOption): void => {
        console.log(option)
        setSelectedModel(option);
    };

    const sendQuestion = () => {
        if (disabled || !question.trim()) {
            return;
        }

        if(conversationId){
            onSend(question, conversationId, selectedModel?.key as ModelType || ModelType.GPT_4);
        }else{
            onSend(question, undefined, selectedModel?.key as ModelType || ModelType.GPT_4);
        }

        if (clearOnSend) {
            setQuestion("");
        }
    };

    const onEnterPress = (ev: React.KeyboardEvent<Element>) => {
        if (ev.key === "Enter" && !ev.shiftKey) {
            ev.preventDefault();
            sendQuestion();
        }
    };

    const onQuestionChange = (_ev: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>, newValue?: string) => {
        setQuestion(newValue || "");
    };

    const sendQuestionDisabled = disabled || !question.trim();

    return (
        <Stack horizontal className={styles.questionInputContainer}>
            <Dropdown 
                className={styles.modelDropdown}
                options={modelOptions}
                onChange={onModelChange}
                selectedKey={selectedModel ? selectedModel.key : undefined}
                defaultSelectedKey={modelOptions[0].key}
                styles={{
                    title: {
                        border: 'none',
                        color: '#0F6CBD',
                        fontWeight: 'bold'
                    },
                    caretDown: {
                        color: '#0F6CBD',
                        fontWeight: 'bold'
                    }
                }}
            />
            <TextField
                className={styles.questionInputTextArea}
                placeholder={placeholder}
                multiline
                resizable={false}
                borderless
                value={question}
                onChange={onQuestionChange}
                onKeyDown={onEnterPress}
            />
            <div className={styles.questionInputSendButtonContainer} 
                role="button" 
                tabIndex={0}
                aria-label="Ask question button"
                onClick={sendQuestion}
                onKeyDown={e => e.key === "Enter" || e.key === " " ? sendQuestion() : null}
            >
                { sendQuestionDisabled ? 
                    <SendRegular className={styles.questionInputSendButtonDisabled}/>
                    :
                    <img src={Send} className={styles.questionInputSendButton}/>
                }
            </div>
            <div className={styles.questionInputBottomBorder} />
        </Stack>
    );
};
