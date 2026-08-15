import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from .sessions_store import SESSIONS_ROOT

# Lives alongside the session directories (not a separate volume) so it
# rides along with whatever persistence the deployment already gives
# `sessions/` - no new docker-compose volume needed. Prefixed so it's
# never mistaken for a session directory (those are 32 hex chars).
DB_PATH = SESSIONS_ROOT / "_app.db"


@contextmanager
def db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with db_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                google_sub TEXT UNIQUE NOT NULL,
                email TEXT NOT NULL,
                name TEXT NOT NULL,
                picture TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                owner_user_id INTEGER NOT NULL REFERENCES users(id),
                created_at TEXT NOT NULL
            )
            """
        )


def upsert_user(google_sub: str, email: str, name: str, picture: str | None) -> sqlite3.Row:
    now = datetime.now(timezone.utc).isoformat()
    with db_connection() as conn:
        conn.execute(
            """
            INSERT INTO users (google_sub, email, name, picture, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture
            """,
            (google_sub, email, name, picture, now),
        )
        return conn.execute("SELECT * FROM users WHERE google_sub = ?", (google_sub,)).fetchone()


def get_user_by_id(user_id: int) -> sqlite3.Row | None:
    with db_connection() as conn:
        return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def record_session_owner(session_id: str, owner_user_id: int) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with db_connection() as conn:
        conn.execute(
            "INSERT INTO sessions (session_id, owner_user_id, created_at) VALUES (?, ?, ?)",
            (session_id, owner_user_id, now),
        )


def list_sessions_for_user(owner_user_id: int) -> list[sqlite3.Row]:
    with db_connection() as conn:
        return conn.execute(
            "SELECT session_id, created_at FROM sessions WHERE owner_user_id = ? ORDER BY created_at DESC",
            (owner_user_id,),
        ).fetchall()


init_db()
