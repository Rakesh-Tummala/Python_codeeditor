import os
import secrets
from pathlib import Path
from urllib.parse import urlencode

import httpx
from dotenv import load_dotenv, set_key
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel

from . import db

load_dotenv()

router = APIRouter(prefix="/api/auth", tags=["auth"])

_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI = os.environ.get("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/auth/google/callback")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")

TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30  # 30 days


def _get_or_create_secret_key() -> str:
    key = os.environ.get("AUTH_SECRET_KEY")
    if key:
        return key
    # First run on this machine: mint a key and persist it the same way
    # GEMINI_API_KEY/GITHUB_TOKEN_KEY are - existing tokens stop verifying
    # if this changes, so it's generated once and kept, not regenerated
    # per process.
    key = secrets.token_urlsafe(32)
    _ENV_PATH.touch(exist_ok=True)
    set_key(str(_ENV_PATH), "AUTH_SECRET_KEY", key)
    os.environ["AUTH_SECRET_KEY"] = key
    return key


_serializer = URLSafeTimedSerializer(_get_or_create_secret_key(), salt="pytrace-auth")

# CSRF protection for the OAuth handshake - short-lived (the few seconds
# between redirect-out and redirect-back), fine to lose on a restart.
_pending_states: set[str] = set()


class CurrentUser(BaseModel):
    id: int
    email: str
    name: str
    picture: str | None


def create_token(user_id: int) -> str:
    return _serializer.dumps({"user_id": user_id})


def get_user_by_token(token: str) -> CurrentUser:
    try:
        data = _serializer.loads(token, max_age=TOKEN_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        raise HTTPException(status_code=401, detail="invalid or expired token")
    row = db.get_user_by_id(data["user_id"])
    if not row:
        raise HTTPException(status_code=401, detail="user not found")
    return CurrentUser(id=row["id"], email=row["email"], name=row["name"], picture=row["picture"])


_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> CurrentUser:
    # REST calls send a real Authorization header; WebSocket connections
    # (collab.py, terminal.py) can't set custom headers from browser JS,
    # so they fall back to a query param instead.
    token = credentials.credentials if credentials else request.query_params.get("token")
    if not token:
        raise HTTPException(status_code=401, detail="not authenticated")
    return get_user_by_token(token)


@router.get("/google/login")
def google_login():
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google OAuth is not configured (GOOGLE_CLIENT_ID missing)")
    state = secrets.token_urlsafe(16)
    _pending_states.add(state)
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}")


@router.get("/google/callback")
def google_callback(code: str | None = None, state: str | None = None, error: str | None = None):
    if error:
        return RedirectResponse(f"{FRONTEND_URL}/?auth_error={error}")
    if not state or state not in _pending_states:
        raise HTTPException(status_code=400, detail="invalid OAuth state")
    _pending_states.discard(state)
    if not code:
        raise HTTPException(status_code=400, detail="missing authorization code")

    token_resp = httpx.post(
        "https://oauth2.googleapis.com/token",
        data={
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": GOOGLE_REDIRECT_URI,
            "grant_type": "authorization_code",
        },
        timeout=15,
    )
    if token_resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Google token exchange failed: {token_resp.text}")
    access_token = token_resp.json()["access_token"]

    userinfo_resp = httpx.get(
        "https://openidconnect.googleapis.com/v1/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=15,
    )
    if userinfo_resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Google userinfo request failed")
    info = userinfo_resp.json()

    user = db.upsert_user(
        google_sub=info["sub"],
        email=info.get("email", ""),
        name=info.get("name") or info.get("email", "user"),
        picture=info.get("picture"),
    )
    token = create_token(user["id"])
    # In the URL fragment, not a query string - fragments never get sent
    # to the server (ours or any redirect target), so the token can't leak
    # into server access logs or a Referer header.
    return RedirectResponse(f"{FRONTEND_URL}/#token={token}")


@router.get("/me", response_model=CurrentUser)
def me(current_user: CurrentUser = Depends(get_current_user)):
    return current_user
