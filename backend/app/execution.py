import json
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import CurrentUser, get_current_user
from .sessions_store import get_session_dir, host_mount_path, resolve_safe_path

router = APIRouter(prefix="/api/sessions", tags=["execution"])

SANDBOX_IMAGE = "pytrace-sandbox"
# Must stay above the `timeout 15` baked into docker/entrypoint.sh, so the
# container's own wall-clock kill always has a chance to fire first; this
# is only the backstop for if `docker run` itself never returns.
HOST_TIMEOUT_SECONDS = 25


class RunRequest(BaseModel):
    entry_path: str


class TraceInfo(BaseModel):
    events: list[dict]
    truncated: bool
    error: str | None = None


class RunResponse(BaseModel):
    stdout: str
    stderr: str
    exit_code: int | None
    timed_out: bool
    trace: TraceInfo


def execute_in_sandbox(session_dir: Path, entry_path: str) -> RunResponse:
    # Shared by the plain "Run" endpoint below and by test generation - both
    # need the exact same sandboxed, resource-limited execution, just with
    # different entry files.
    container_entry = f"/workspace/{entry_path}"
    cmd = [
        "docker", "run", "--rm",
        # Outbound network is intentionally allowed (default bridge network) -
        # see SYSTEM_DESIGN.md's sandbox isolation section for the tradeoff
        # this accepts: any code run here, including from an unreviewed
        # cloned repo, can now make outbound connections.
        "--memory", "256m",
        "--cpus", "0.5",
        "--pids-limit", "64",
        "-v", f"{host_mount_path(session_dir)}:/workspace",
        SANDBOX_IMAGE,
        "python", "/opt/pytrace/tracer_runner.py", container_entry,
    ]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=HOST_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="docker run did not return in time")

    # A container killed by ulimit/timeout dies before it can write its
    # final JSON envelope, so stdout won't parse; that itself is the
    # signal that the run was killed rather than completed normally.
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return RunResponse(
            stdout="",
            stderr=proc.stderr or "process was killed before it could report output (resource limit or timeout)",
            exit_code=proc.returncode,
            timed_out=proc.returncode == 137,
            trace=TraceInfo(events=[], truncated=False, error=None),
        )

    return RunResponse(
        stdout=payload["stdout"],
        stderr=payload["stderr"],
        exit_code=proc.returncode,
        timed_out=False,
        trace=TraceInfo(**payload["trace"]),
    )


@router.post("/{session_id}/run", response_model=RunResponse)
def run_file(session_id: str, body: RunRequest, current_user: CurrentUser = Depends(get_current_user)):
    session_dir = get_session_dir(session_id)
    target = resolve_safe_path(session_dir, body.entry_path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    return execute_in_sandbox(session_dir, body.entry_path)
