import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .ai_router import router as ai_router
from .collab import router as collab_router
from .collab import websocket_server
from .execution import router as execution_router
from .files import router as files_router
from .github_integration import router as github_router
from .terminal import router as terminal_router
from .test_gen import router as test_gen_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # WebsocketServer uses anyio structured concurrency internally and
    # must be running before any room can be created - without this,
    # every collab connection accepts and then immediately dies with
    # "WebsocketServer is not running".
    async with websocket_server:
        yield


app = FastAPI(title="PyTrace API", lifespan=lifespan)
app.include_router(files_router)
app.include_router(execution_router)
app.include_router(ai_router)
app.include_router(collab_router)
app.include_router(github_router)
app.include_router(test_gen_router)
app.include_router(terminal_router)

# The frontend is always a different origin from the backend's own port
# (different port in dev, likely a different host entirely in production),
# so the browser blocks requests unless the backend explicitly allows it.
# FRONTEND_ORIGINS is a comma-separated list; defaults to the Vite dev
# server so `docker compose up` and bare `uvicorn` both work with no setup.
_frontend_origins = [
    origin.strip()
    for origin in os.environ.get("FRONTEND_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_frontend_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}
