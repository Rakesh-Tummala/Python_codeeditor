import asyncio
from weakref import WeakSet

from fastapi import APIRouter, WebSocket
from fastapi.exceptions import HTTPException
from pycrdt import Channel, Text
from pycrdt.websocket import WebsocketServer
from pycrdt.websocket.yroom import YRoom

from .sessions_store import get_session_dir, resolve_safe_path

router = APIRouter()

# One process-wide server: rooms are created lazily per (session, file) and
# torn down automatically when the last client disconnects.
websocket_server = WebsocketServer()

# Tracks which room *objects* have already had their initial content
# loaded from disk, so a second/third client joining an already-live room
# doesn't re-seed. Keyed on the object itself (not the room name) because
# auto_clean_rooms means a room can be destroyed and a fresh, empty one
# recreated under the same name later - keying on the name would skip
# seeding that new room forever, since the name would already look
# "handled" even though its Y.Doc has nothing in it.
_seeded_rooms: "WeakSet[YRoom]" = WeakSet()
_save_handles: dict[str, asyncio.TimerHandle] = {}

SAVE_DEBOUNCE_SECONDS = 0.6


class FastAPIChannel(Channel):
    """Adapts a FastAPI WebSocket to the pycrdt Channel protocol (path/send/recv).

    Channel is a Protocol but also supplies concrete __aiter__/__anext__
    bodies - those only come along by actually subclassing it, not from
    structurally matching path/send/recv alone (`async for` checks for a
    real __aiter__ method, it doesn't duck-type against the Protocol).
    """

    def __init__(self, websocket: WebSocket, path: str):
        self._websocket = websocket
        self._path = path

    @property
    def path(self) -> str:
        return self._path

    async def send(self, message: bytes) -> None:
        await self._websocket.send_bytes(message)

    async def recv(self) -> bytes:
        message = await self._websocket.receive_bytes()
        return bytes(message)


@router.websocket("/api/yjs/{session_id}/{file_path:path}")
async def yjs_room(websocket: WebSocket, session_id: str, file_path: str):
    try:
        session_dir = get_session_dir(session_id)
        target = resolve_safe_path(session_dir, file_path)
    except HTTPException:
        await websocket.close(code=4404)
        return

    await websocket.accept()
    room_name = f"{session_id}:{file_path}"
    room = await websocket_server.get_room(room_name)
    ytext = room.ydoc.get("content", type=Text)

    if room not in _seeded_rooms:
        _seeded_rooms.add(room)
        if len(ytext) == 0 and target.is_file():
            existing = target.read_text(encoding="utf-8")
            if existing:
                ytext.insert(0, existing)

    def on_change(event):
        loop = asyncio.get_running_loop()
        pending = _save_handles.get(room_name)
        if pending is not None:
            pending.cancel()

        def do_save():
            target.write_text(ytext.to_py(), encoding="utf-8")

        _save_handles[room_name] = loop.call_later(SAVE_DEBOUNCE_SECONDS, do_save)

    subscription = ytext.observe(on_change)

    try:
        channel = FastAPIChannel(websocket, room_name)
        await room.serve(channel)
    finally:
        ytext.unobserve(subscription)
