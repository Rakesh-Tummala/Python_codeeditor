import os
import re
import uuid
from pathlib import Path, PurePosixPath

from fastapi import HTTPException

SESSIONS_ROOT = Path(__file__).resolve().parent.parent / "sessions"
SESSIONS_ROOT.mkdir(parents=True, exist_ok=True)

# When the backend itself runs inside a container (docker-compose), its
# `docker run -v ...` calls still go to the *host's* daemon - a sibling
# container, not a nested one - so a `-v` source has to be a path that
# means something on the HOST, not inside the backend's own container
# filesystem. HOST_SESSIONS_DIR is set in that deployment to the host-side
# path bind-mounted into this container at SESSIONS_ROOT; left unset (the
# bare-metal dev case, backend and Docker daemon on the same machine),
# SESSIONS_ROOT already *is* a host path and no translation is needed.
_HOST_SESSIONS_ROOT = os.environ.get("HOST_SESSIONS_DIR")


def host_mount_path(path: Path) -> str:
    if not _HOST_SESSIONS_ROOT:
        return path.as_posix()
    relative = path.resolve().relative_to(SESSIONS_ROOT.resolve())
    return str(PurePosixPath(_HOST_SESSIONS_ROOT) / relative)

_SESSION_ID_RE = re.compile(r"^[0-9a-f]{32}$")


def create_session() -> str:
    session_id = uuid.uuid4().hex
    (SESSIONS_ROOT / session_id).mkdir(parents=True, exist_ok=True)
    return session_id


def get_session_dir(session_id: str) -> Path:
    # session_id ends up as a path segment too, so it needs the same
    # strict validation as any other user-supplied path component.
    if not _SESSION_ID_RE.match(session_id):
        raise HTTPException(status_code=404, detail="session not found")
    session_dir = SESSIONS_ROOT / session_id
    if not session_dir.is_dir():
        raise HTTPException(status_code=404, detail="session not found")
    return session_dir


def resolve_safe_path(session_dir: Path, rel_path: str) -> Path:
    """Resolve rel_path against session_dir, guaranteeing the result stays inside it.

    Joining a base path with an absolute rel_path (e.g. "/etc/passwd" or
    "C:/Windows") silently discards the base in pathlib, and ".." segments
    can walk back out of it. Checking containment on the *resolved* path
    catches both cases regardless of how the escape was attempted.
    """
    candidate = (session_dir / rel_path).resolve()
    if not candidate.is_relative_to(session_dir.resolve()):
        raise HTTPException(status_code=400, detail="invalid path")
    return candidate
