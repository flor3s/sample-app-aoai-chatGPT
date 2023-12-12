from functools import wraps
import logging
import os

from flask import request, jsonify
from okta_jwt_verifier import AccessTokenVerifier
from okta_jwt_verifier.jwt_utils import JWTUtils

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    pass

load_dotenv()

logging.basicConfig(level=logging.INFO)

OKTA_JWT_ISSUER = os.environ.get("OKTA_JWT_ISSUER")
OKTA_JWT_AUDIENCE = os.environ.get("OKTA_JWT_AUDIENCE")

"""
Private method to verify JWT access token.
"""
async def _verify_jwt_access_token(token: str) -> dict:
    verifier = AccessTokenVerifier(issuer=f'{OKTA_JWT_ISSUER}', audience=f'{OKTA_JWT_AUDIENCE}')
    try:
        await verifier.verify(token)
        return JWTUtils.parse_token(token)[1] # Returns the JWT claims only
    except Exception:
        return None


"""
Decorator to verify JWT access token.
Add to any route that requires authentication.
If authentication succeeds, passes the JWT claims to the route.
:returns: 401 if no token is provided.
:returns: 403 if token is invalid.
"""
def jwt_required(f):
    @wraps(f)
    async def decorated(*args, **kwargs):
        jwt_claims = None
        token: str = None
        is_auth_disabled: bool = os.getenv("JWT_AUTH_DISABLED", "false").lower() == "true"

        if is_auth_disabled:
            logging.info('Running locally, skipping auth')
        else:
            try:
                token = request.headers["Authorization"].split(" ")[1]
            except Exception:
                pass

            if not token:
                return jsonify({
                    "message": "Unauthorized",
                    "data": None,
                    "error": "Unauthorized"
                }), 401
            try:
                jwt_claims = await _verify_jwt_access_token(token)
                if jwt_claims is None:
                    return jsonify({
                        "message": "Unauthorized",
                        "data": None,
                        "error": "Unauthorized"
                    }), 403
            except Exception as e:
                return jsonify({
                    "message": "Something went wrong",
                    "data": None,
                    "error": str(e)
                }), 500

        return f(jwt_claims, *args, **kwargs)
    return decorated