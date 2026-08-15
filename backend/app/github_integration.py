import base64
import json
import os
import re
import subprocess
from pathlib import Path

import httpx
from cryptography.fernet import Fernet
from dotenv import set_key
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import CurrentUser, get_current_user
from .sessions_store import SESSIONS_ROOT, get_session_dir

GITHUB_API = "https://api.github.com"
_GITHUB_URL_RE = re.compile(r"github\.com[/:]([^/]+)/([^/.]+)(?:\.git)?/?$")

router = APIRouter(prefix="/api/sessions", tags=["github"])

_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


def _get_or_create_encryption_key() -> bytes:
    key = os.environ.get("GITHUB_TOKEN_KEY")
    if key:
        return key.encode()
    # First run on this machine: mint a key and persist it next to the
    # other secrets, the same way GEMINI_API_KEY is managed - set_key
    # updates just this one line, leaving any existing entries alone.
    key = Fernet.generate_key()
    _ENV_PATH.touch(exist_ok=True)
    set_key(str(_ENV_PATH), "GITHUB_TOKEN_KEY", key.decode())
    os.environ["GITHUB_TOKEN_KEY"] = key.decode()
    return key


_fernet = Fernet(_get_or_create_encryption_key())


def _meta_path(session_id: str) -> Path:
    # Deliberately a sibling of the session directory, not inside it -
    # resolve_safe_path only ever resolves paths *within* a session_dir,
    # so this file is structurally unreachable through the file-tree/read
    # /write endpoints, and it never sits inside the cloned repo either,
    # so it can't accidentally get swept up by `git add -A`.
    return SESSIONS_ROOT / f"{session_id}.github.json"


def _save_meta(session_id: str, repo_dir: str, remote_url: str, token: str) -> None:
    encrypted_token = _fernet.encrypt(token.encode()).decode() if token else ""
    data = {"repo_dir": repo_dir, "remote_url": remote_url, "token": encrypted_token}
    _meta_path(session_id).write_text(json.dumps(data), encoding="utf-8")


def _load_meta(session_id: str) -> dict:
    path = _meta_path(session_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="no GitHub repo connected to this session")
    return json.loads(path.read_text(encoding="utf-8"))


def _decrypt_token(encrypted_token: str) -> str | None:
    if not encrypted_token:
        return None
    return _fernet.decrypt(encrypted_token.encode()).decode()


def _auth_header(token: str) -> str:
    # GitHub's documented pattern for PAT-over-HTTPS: any non-empty
    # username with the token as the password, here as a Basic-auth
    # header injected only for this one git invocation.
    basic = base64.b64encode(f"x-access-token:{token}".encode()).decode()
    return f"AUTHORIZATION: Basic {basic}"


def _run_git(cwd: Path, args: list[str], token: str | None = None) -> subprocess.CompletedProcess:
    cmd = ["git"]
    if token:
        # -c sets this only for the current process, never written to
        # .git/config - the token never touches disk in the repo itself,
        # and never appears in `git remote -v` or any committed history.
        cmd += ["-c", f"http.extraHeader={_auth_header(token)}"]
    cmd += args
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=60)


def _repo_name_from_url(url: str) -> str:
    name = url.rstrip("/").rsplit("/", 1)[-1]
    if name.endswith(".git"):
        name = name[:-4]
    return name or "repo"


class CloneRequest(BaseModel):
    repo_url: str
    token: str | None = None


class CloneResponse(BaseModel):
    repo_dir: str


class CommitPushRequest(BaseModel):
    message: str


class GitActionResponse(BaseModel):
    output: str


class GitStatusResponse(BaseModel):
    connected: bool
    repo_dir: str | None = None
    remote_url: str | None = None
    branch: str | None = None
    changes: list[str] = []


class PullRequestInfo(BaseModel):
    number: int
    title: str
    html_url: str
    state: str
    user: str
    head: str
    base: str


class ListPRsResponse(BaseModel):
    pull_requests: list[PullRequestInfo]


class CreatePRRequest(BaseModel):
    title: str
    body: str = ""
    base: str | None = None


class CreatePRResponse(BaseModel):
    number: int
    html_url: str


def _parse_github_repo(remote_url: str) -> tuple[str, str] | None:
    match = _GITHUB_URL_RE.search(remote_url)
    if not match:
        return None
    return match.group(1), match.group(2)


def _api_headers(token: str | None) -> dict:
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


@router.post("/{session_id}/git/clone", response_model=CloneResponse)
def clone_repo(session_id: str, body: CloneRequest, current_user: CurrentUser = Depends(get_current_user)):
    session_dir = get_session_dir(session_id)
    repo_name = _repo_name_from_url(body.repo_url)
    target = session_dir / repo_name
    if target.exists():
        raise HTTPException(status_code=409, detail=f"'{repo_name}' already exists in this session")

    result = _run_git(session_dir, ["clone", body.repo_url, repo_name], token=body.token)
    if result.returncode != 0:
        raise HTTPException(status_code=400, detail=f"git clone failed: {result.stderr.strip()}")

    _save_meta(session_id, repo_name, body.repo_url, body.token or "")
    return CloneResponse(repo_dir=repo_name)


@router.get("/{session_id}/git/status", response_model=GitStatusResponse)
def git_status(session_id: str, current_user: CurrentUser = Depends(get_current_user)):
    session_dir = get_session_dir(session_id)
    if not _meta_path(session_id).is_file():
        return GitStatusResponse(connected=False)

    meta = _load_meta(session_id)
    repo_dir = session_dir / meta["repo_dir"]
    if not repo_dir.is_dir():
        return GitStatusResponse(connected=False)

    branch_result = _run_git(repo_dir, ["branch", "--show-current"])
    status_result = _run_git(repo_dir, ["status", "--short"])
    changes = [line for line in status_result.stdout.splitlines() if line.strip()]
    return GitStatusResponse(
        connected=True,
        repo_dir=meta["repo_dir"],
        remote_url=meta["remote_url"],
        branch=branch_result.stdout.strip() or None,
        changes=changes,
    )


@router.post("/{session_id}/git/commit-and-push", response_model=GitActionResponse)
def commit_and_push(session_id: str, body: CommitPushRequest, current_user: CurrentUser = Depends(get_current_user)):
    session_dir = get_session_dir(session_id)
    meta = _load_meta(session_id)
    repo_dir = session_dir / meta["repo_dir"]
    if not repo_dir.is_dir():
        raise HTTPException(status_code=404, detail="repo directory not found")

    token = _decrypt_token(meta["token"])

    add_result = _run_git(repo_dir, ["add", "-A"])
    if add_result.returncode != 0:
        raise HTTPException(status_code=400, detail=f"git add failed: {add_result.stderr.strip()}")

    commit_result = _run_git(repo_dir, ["commit", "-m", body.message])
    if commit_result.returncode != 0:
        detail = (commit_result.stdout + commit_result.stderr).strip()
        raise HTTPException(status_code=400, detail=f"git commit failed: {detail}")

    push_result = _run_git(repo_dir, ["push"], token=token)
    if push_result.returncode != 0:
        raise HTTPException(status_code=400, detail=f"git push failed: {push_result.stderr.strip()}")

    return GitActionResponse(output=(commit_result.stdout + push_result.stderr).strip())


@router.get("/{session_id}/git/prs", response_model=ListPRsResponse)
def list_prs(session_id: str, current_user: CurrentUser = Depends(get_current_user)):
    meta = _load_meta(session_id)
    owner_repo = _parse_github_repo(meta["remote_url"])
    if not owner_repo:
        raise HTTPException(status_code=400, detail="connected remote is not a GitHub repository")
    owner, repo = owner_repo
    token = _decrypt_token(meta["token"])

    resp = httpx.get(
        f"{GITHUB_API}/repos/{owner}/{repo}/pulls",
        params={"state": "open"},
        headers=_api_headers(token),
        timeout=15,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=f"GitHub API error: {resp.text}")

    pull_requests = [
        PullRequestInfo(
            number=p["number"],
            title=p["title"],
            html_url=p["html_url"],
            state=p["state"],
            user=p["user"]["login"],
            head=p["head"]["ref"],
            base=p["base"]["ref"],
        )
        for p in resp.json()
    ]
    return ListPRsResponse(pull_requests=pull_requests)


@router.post("/{session_id}/git/prs", response_model=CreatePRResponse)
def create_pr(session_id: str, body: CreatePRRequest, current_user: CurrentUser = Depends(get_current_user)):
    session_dir = get_session_dir(session_id)
    meta = _load_meta(session_id)
    owner_repo = _parse_github_repo(meta["remote_url"])
    if not owner_repo:
        raise HTTPException(status_code=400, detail="connected remote is not a GitHub repository")
    owner, repo = owner_repo
    token = _decrypt_token(meta["token"])
    if not token:
        raise HTTPException(status_code=400, detail="creating a pull request requires a GitHub token")

    repo_dir = session_dir / meta["repo_dir"]
    if not repo_dir.is_dir():
        raise HTTPException(status_code=404, detail="repo directory not found")
    branch_result = _run_git(repo_dir, ["branch", "--show-current"])
    head = branch_result.stdout.strip()
    if not head:
        raise HTTPException(status_code=400, detail="repo is not currently on a branch")

    base = body.base
    if not base:
        repo_info = httpx.get(f"{GITHUB_API}/repos/{owner}/{repo}", headers=_api_headers(token), timeout=15)
        if repo_info.status_code != 200:
            raise HTTPException(status_code=repo_info.status_code, detail=f"GitHub API error: {repo_info.text}")
        base = repo_info.json()["default_branch"]

    resp = httpx.post(
        f"{GITHUB_API}/repos/{owner}/{repo}/pulls",
        json={"title": body.title, "body": body.body, "head": head, "base": base},
        headers=_api_headers(token),
        timeout=15,
    )
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=resp.status_code, detail=f"GitHub API error: {resp.text}")

    data = resp.json()
    return CreatePRResponse(number=data["number"], html_url=data["html_url"])
