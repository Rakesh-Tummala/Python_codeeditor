import asyncio
import json
import os

import docker
from docker.errors import DockerException
from docker.utils.socket import read as docker_socket_read
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from .auth import get_user_by_token
from .sessions_store import get_session_dir, host_mount_path

router = APIRouter()

SANDBOX_IMAGE = "pytrace-sandbox"
SANDBOX_UID = "10001"

_docker_client: docker.DockerClient | None = None


def _client() -> docker.DockerClient:
    global _docker_client
    if _docker_client is None:
        _docker_client = docker.from_env()
    return _docker_client


def _write_to_docker_socket(sock, data: bytes) -> None:
    # attach_socket()'s return type is transport-dependent: a raw duplex
    # socket with .sendall() on Windows npipe, but over the Unix socket
    # every real Linux deployment uses, it's a *read-only* socket.SocketIO
    # wrapping the real socket - .write() on it raises UnsupportedOperation,
    # so the writable side has to be reached via its `_sock` attribute.
    # docker-py itself only ships a matching *read* helper
    # (docker.utils.socket.read), not a write one, hence this.
    target = sock._sock if hasattr(sock, "_sock") else sock
    if hasattr(target, "sendall"):
        target.sendall(data)
    elif hasattr(target, "write"):
        target.write(data)
    else:
        os.write(target.fileno(), data)


@router.websocket("/api/sessions/{session_id}/terminal")
async def terminal_ws(websocket: WebSocket, session_id: str):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4401)
        return
    try:
        get_user_by_token(token)
    except HTTPException:
        await websocket.close(code=4401)
        return

    session_dir = get_session_dir(session_id)
    await websocket.accept()

    client = _client()
    # Same isolation as script execution (non-root, capped memory/cpu/pids)
    # but long-lived and with a real shell as PID 1 instead of the
    # entrypoint's single-script-and-exit wrapper - a terminal has to
    # persist between commands, not run one and terminate. Network is
    # intentionally allowed (default bridge) - see SYSTEM_DESIGN.md.
    container = client.containers.run(
        SANDBOX_IMAGE,
        entrypoint=["/bin/sh"],
        detach=True,
        tty=True,
        stdin_open=True,
        mem_limit="256m",
        nano_cpus=int(0.5 * 1e9),
        pids_limit=64,
        user=SANDBOX_UID,
        working_dir="/workspace",
        volumes={host_mount_path(session_dir): {"bind": "/workspace", "mode": "rw"}},
        remove=True,
    )

    sock = client.api.attach_socket(container.id, params={"stdin": 1, "stdout": 1, "stderr": 1, "stream": 1})
    loop = asyncio.get_running_loop()

    async def pump_container_to_ws():
        while True:
            try:
                data = await loop.run_in_executor(None, docker_socket_read, sock, 4096)
            except (OSError, ValueError):
                break
            if not data:
                break
            await websocket.send_text(data.decode("utf-8", errors="replace"))

    reader_task = asyncio.create_task(pump_container_to_ws())
    try:
        while True:
            text = await websocket.receive_text()
            # A resize arrives as JSON (`{"resize": {"cols": .., "rows": ..}}`);
            # everything else is raw keystrokes to feed straight to the PTY.
            # Real typed input matching that exact shape is not a concern in
            # practice for an interactive shell session.
            is_resize = False
            if text.startswith("{"):
                try:
                    payload = json.loads(text)
                except json.JSONDecodeError:
                    payload = None
                if isinstance(payload, dict) and "resize" in payload:
                    is_resize = True
                    cols = payload["resize"].get("cols")
                    rows = payload["resize"].get("rows")
                    if cols and rows:
                        try:
                            container.resize(height=rows, width=cols)
                        except DockerException:
                            pass
            if not is_resize:
                await loop.run_in_executor(None, _write_to_docker_socket, sock, text.encode())
    except WebSocketDisconnect:
        pass
    finally:
        reader_task.cancel()
        try:
            sock.close()
        except OSError:
            pass
        try:
            container.stop(timeout=1)
        except DockerException:
            pass
