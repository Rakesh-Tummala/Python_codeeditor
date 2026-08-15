import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .sessions_store import create_session, get_session_dir, resolve_safe_path

router = APIRouter(prefix="/api/sessions", tags=["files"])


class CreateSessionResponse(BaseModel):
    session_id: str


class WriteFileBody(BaseModel):
    content: str


class CreateEntryBody(BaseModel):
    is_dir: bool = False


class RenameBody(BaseModel):
    old_path: str
    new_path: str


def _build_tree(dir_path: Path, session_dir: Path) -> list[dict[str, Any]]:
    entries = []
    for entry in sorted(dir_path.iterdir(), key=lambda p: (p.is_file(), p.name.lower())):
        rel = entry.relative_to(session_dir).as_posix()
        if entry.is_dir():
            entries.append(
                {"name": entry.name, "path": rel, "type": "dir", "children": _build_tree(entry, session_dir)}
            )
        else:
            entries.append({"name": entry.name, "path": rel, "type": "file"})
    return entries


@router.post("", response_model=CreateSessionResponse)
def new_session():
    return {"session_id": create_session()}


@router.get("/{session_id}/files")
def list_files(session_id: str):
    session_dir = get_session_dir(session_id)
    return {"tree": _build_tree(session_dir, session_dir)}


@router.get("/{session_id}/files/{file_path:path}")
def read_file(session_id: str, file_path: str):
    session_dir = get_session_dir(session_id)
    target = resolve_safe_path(session_dir, file_path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    return {"path": file_path, "content": target.read_text(encoding="utf-8")}


@router.put("/{session_id}/files/{file_path:path}")
def write_file(session_id: str, file_path: str, body: WriteFileBody):
    session_dir = get_session_dir(session_id)
    target = resolve_safe_path(session_dir, file_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body.content, encoding="utf-8")
    return {"path": file_path}


@router.post("/{session_id}/files/{file_path:path}")
def create_entry(session_id: str, file_path: str, body: CreateEntryBody):
    session_dir = get_session_dir(session_id)
    target = resolve_safe_path(session_dir, file_path)
    if target.exists():
        raise HTTPException(status_code=409, detail="already exists")
    if body.is_dir:
        target.mkdir(parents=True)
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.touch()
    return {"path": file_path}


@router.delete("/{session_id}/files/{file_path:path}")
def delete_entry(session_id: str, file_path: str):
    session_dir = get_session_dir(session_id)
    target = resolve_safe_path(session_dir, file_path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="not found")
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
    return {"path": file_path}


@router.post("/{session_id}/rename")
def rename_entry(session_id: str, body: RenameBody):
    session_dir = get_session_dir(session_id)
    old_target = resolve_safe_path(session_dir, body.old_path)
    new_target = resolve_safe_path(session_dir, body.new_path)
    if not old_target.exists():
        raise HTTPException(status_code=404, detail="not found")
    if new_target.exists():
        raise HTTPException(status_code=409, detail="already exists")
    new_target.parent.mkdir(parents=True, exist_ok=True)
    old_target.rename(new_target)
    return {"path": body.new_path}
