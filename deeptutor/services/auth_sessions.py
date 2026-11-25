"""Persistent browser sessions. Only a digest of the bearer credential is stored."""

from contextlib import contextmanager
from hashlib import sha256
import secrets
import sqlite3
import time


@contextmanager
def _database():
    from deeptutor.multi_user.paths import SYSTEM_ROOT

    directory = SYSTEM_ROOT / "auth"
    directory.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(directory / "sessions.sqlite3")
    try:
        with db:
            db.execute(
                """CREATE TABLE IF NOT EXISTS sessions (
                    digest TEXT PRIMARY KEY, username TEXT NOT NULL,
                    user_id TEXT NOT NULL, expires_at REAL NOT NULL, upstream_token TEXT
                )"""
            )
            yield db
    finally:
        db.close()


def _digest(token: str) -> str:
    return sha256(token.encode()).hexdigest()


def issue(username: str, user_id: str, lifetime: int, upstream_token: str | None = None) -> str:
    token = "cws_" + secrets.token_urlsafe(32)
    now = time.time()
    with _database() as db:
        db.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
        db.execute(
            "INSERT INTO sessions VALUES (?, ?, ?, ?, ?)",
            (_digest(token), username, user_id, now + lifetime, upstream_token),
        )
    return token


def lookup(token: str) -> tuple[str, str, str | None] | None:
    if len(token) != 47 or not token.startswith("cws_"):
        return None
    with _database() as db:
        return db.execute(
            "SELECT username, user_id, upstream_token FROM sessions "
            "WHERE digest = ? AND expires_at > ?",
            (_digest(token), time.time()),
        ).fetchone()


def revoke(token: str | None) -> None:
    if token and len(token) == 47 and token.startswith("cws_"):
        with _database() as db:
            db.execute("DELETE FROM sessions WHERE digest = ?", (_digest(token),))
