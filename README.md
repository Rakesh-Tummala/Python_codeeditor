# PyTrace

A collaborative Python execution/debugging environment with AI assistance,
multi-file projects, and GitHub integration. Write Python in a real Monaco editor,
run it in an isolated sandbox with a full `sys.settrace` execution trace, step through
it line by line, debug it together with someone else in real time, ask Gemini to
explain or fix a crash, generate tests that actually run, and push the result to a
real GitHub repo — all from one app.

For how it's built under the hood — architecture, sequence diagrams for each feature,
the security model, and known tradeoffs — see **[SYSTEM_DESIGN.md](SYSTEM_DESIGN.md)**.

## Features

**Core**
- Multi-file Python projects: file tree, tabs, autosave
- Real execution in an isolated Docker sandbox (non-root, no network, capped
  memory/CPU/PIDs, multiple layered timeouts)
- A full `sys.settrace` trace of every run — step forward/back, inspect variables and
  the call stack at any point, set breakpoints by clicking a line number
- AI-grounded debugging: "Explain this error" and "Explain this code" (Gemini),
  answers reference the *actual* variable values at the point of failure

**Collaboration**
- Real-time collaborative editing (Yjs CRDT) with a shareable session link and live
  presence indicators
- Shared collaborative debugging — one "driver" steps through a trace, everyone else
  in the session watches the same line and variables update live

**AI**
- AI auto-fix: Gemini proposes a corrected file, shown as a diff — never auto-applied,
  you explicitly accept or reject it
- AI-generated tests that are genuinely executed through the same sandbox as a normal
  run (real pass/fail, not just displayed text)
- AI code review: categorized comments (bug-risk / style / complexity) rendered as
  real inline Monaco annotations with hover tooltips, not just a text blob

**GitHub**
- Clone a real repo into your session, edit it, commit and push back (encrypted token
  storage, never logged)
- View open PRs for the connected repo and create a new one from the current branch

**Terminal**
- A genuinely interactive shell inside the sandbox (`xterm.js` + Docker's own PTY
  allocation), same isolation guarantees as script execution

## Quick start

### Option A — Docker Compose (closest to a real deployment)

```bash
cp .env.example .env
# edit .env: set PYTRACE_HOST_DATA_DIR to an absolute path on your machine,
# and GEMINI_API_KEY if you want the AI features working

docker compose build
docker compose up -d
```

Frontend: http://localhost:5173 · Backend: http://localhost:8000

This mode runs the backend in its own container with the host's Docker socket
mounted in, so it can spawn sandbox containers as siblings — see
[SYSTEM_DESIGN.md §7](SYSTEM_DESIGN.md#7-deployment-topology) for exactly how that
works and the privilege tradeoff it implies.

### Option B — Local dev (hot reload on both sides)

Prerequisites: Python 3.11+, Node 20+, Docker Desktop (for the sandbox image).

```bash
# One-time: build the sandbox image
docker build -f docker/sandbox.Dockerfile -t pytrace-sandbox docker

# Backend
cd backend
python -m venv venv && source venv/Scripts/activate   # or venv/bin/activate on macOS/Linux
pip install -r requirements.txt
cp .env.example .env   # add your GEMINI_API_KEY
uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Frontend: http://localhost:5173 · Backend: http://localhost:8000

## Configuration

| File | Purpose |
|---|---|
| `backend/.env.example` | `GEMINI_API_KEY`, `FRONTEND_ORIGINS` (CORS), `GITHUB_TOKEN_KEY` |
| `frontend/.env.example` | `VITE_API_HTTP_BASE`, `VITE_API_WS_BASE` — where the frontend finds the backend |
| `.env.example` (root) | Docker Compose-only: `PYTRACE_HOST_DATA_DIR` and the above, injected into both containers |

`GITHUB_TOKEN_KEY` encrypts stored GitHub tokens at rest (Fernet). In local dev it's
auto-generated into `backend/.env` on first run; in Docker Compose, generate one
explicitly and set it in the root `.env` — see the comment in `.env.example` for why.

A Gemini API key is free to get at [Google AI Studio](https://aistudio.google.com/apikey).
The free tier caps at 20 requests/day for the model this project uses — everything
except the AI features (Explain/Fix/Review/Generate Tests) works without one.

## What's built vs. planned

Everything in the original plan is built and verified end-to-end: P0 (core execution
and debugging), P1 (real-time collaboration, AI auto-fix, GitHub integration), and P2
(shared collaborative debugging, AI test generation and code review, GitHub PRs, and a
real terminal).

From the plan's own buffer week, done: bug fixes and polish, Docker Compose
deployment, CI, and this documentation. Not done: a demo video (out of scope for this
pass by request).

## CI

`.github/workflows/ci.yml` runs on every push/PR: backend import check, frontend
lint + the real typecheck-and-build (`tsc -b && vite build` — see
[SYSTEM_DESIGN.md §6](SYSTEM_DESIGN.md#6-known-limitations-and-tradeoffs) for why "the
real one" is worth calling out explicitly), and a build of all three Docker images.

## Security notes

The sandbox (script execution, generated tests, and the terminal) runs as a non-root
user with no network access and capped memory/CPU/process count — every one of these
constraints was verified by actually trying to violate it, not just configured and
assumed. GitHub tokens are encrypted at rest and never logged. Full detail, including
the tradeoffs that come with this project's specific architecture (notably the
Docker-outside-of-Docker socket mount in the Compose deployment), is in
[SYSTEM_DESIGN.md §5–6](SYSTEM_DESIGN.md#5-sandbox-isolation-model).
