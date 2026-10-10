"""Persistent, atomic login-attempt budgets shared by workers on one host.

All attempts (not just failures) reserve capacity before password verification.
Rejected attempts do not extend the window. This is a bounded cooldown, not a
permanent account lock. Independent hosts must use a shared rate-limit service.
"""

from __future__ import annotations

from contextlib import closing
from dataclasses import dataclass
import hashlib
import hmac
import math
import os
from pathlib import Path
import sqlite3
import time
from typing import Callable


@dataclass(frozen=True)
class AttemptBudget:
    limit: int
    seconds: int

    def __post_init__(self) -> None:
        if self.limit < 1 or self.seconds < 1:
            raise ValueError("Login attempt limits and windows must be positive")


class LoginThrottle:
    def __init__(
        self,
        path: Path,
        *,
        secret: str,
        pair: AttemptBudget = AttemptBudget(5, 60),
        account: AttemptBudget = AttemptBudget(20, 300),
        ip: AttemptBudget = AttemptBudget(300, 60),
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.path = path
        self.secret = secret.encode("utf-8")
        self.budgets = (pair, account, ip)
        self.clock = clock

    def _key(self, kind: str, *parts: str) -> str:
        # Length-prefix components to prevent ambiguous account/IP pairs.
        value = kind + "".join(f"{len(part)}:{part}" for part in parts)
        return hmac.new(self.secret, value.encode("utf-8"), hashlib.sha256).hexdigest()

    def reserve(self, username: str, ip: str) -> int:
        """Return 0 if accepted, otherwise seconds until all blocked budgets reset.

        BEGIN IMMEDIATE serializes the entire read/check/increment operation,
        including across processes. Never store passwords, raw names or IPs.
        """
        keys = (
            self._key("pair", username, ip),
            self._key("account", username),
            self._key("ip", ip),
        )
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path, timeout=5, isolation_level=None)) as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                now = self.clock()
                conn.execute(
                    "CREATE TABLE IF NOT EXISTS attempts "
                    "(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires REAL NOT NULL)"
                )
                conn.execute("CREATE INDEX IF NOT EXISTS attempts_expiry ON attempts(expires)")
                conn.execute("DELETE FROM attempts WHERE expires <= ?", (now,))
                entries = []
                retry_after = 0
                for key, budget in zip(keys, self.budgets, strict=True):
                    row = conn.execute(
                        "SELECT count, expires FROM attempts WHERE key = ?", (key,)
                    ).fetchone()
                    count, expires = row if row else (0, now + budget.seconds)
                    entries.append((key, count + 1, expires))
                    if count >= budget.limit:
                        retry_after = max(retry_after, math.ceil(expires - now))
                if not retry_after:
                    conn.executemany(
                        "INSERT INTO attempts(key, count, expires) VALUES (?, ?, ?) "
                        "ON CONFLICT(key) DO UPDATE SET count=excluded.count, "
                        "expires=excluded.expires",
                        entries,
                    )
                conn.execute("COMMIT")
                return retry_after
            except Exception:
                conn.execute("ROLLBACK")
                raise


def _build_auth_throttle(kind: str, defaults: tuple[AttemptBudget, AttemptBudget, AttemptBudget]) -> LoginThrottle:
    from deeptutor.multi_user.identity import load_or_create_auth_secret
    from deeptutor.multi_user.paths import SYSTEM_ROOT
    from deeptutor.services.auth import AUTH_SECRET
    from deeptutor.services.config import get_env_store

    values = get_env_store().load()

    def budget(scope: str, limit: int, seconds: int) -> AttemptBudget:
        def positive_int(suffix: str, default: int) -> int:
            key = f"AUTH_{kind}_{scope}_{suffix}"
            raw = os.environ.get(key, values.get(key, str(default)))
            try:
                parsed = int(raw)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"{key} must be a positive integer") from exc
            if parsed < 1:
                raise ValueError(f"{key} must be a positive integer")
            return parsed

        return AttemptBudget(
            positive_int("LIMIT", limit), positive_int("WINDOW_SECONDS", seconds)
        )

    return LoginThrottle(
        SYSTEM_ROOT / "auth" / f"{kind.lower()}_attempts.sqlite3",
        secret=AUTH_SECRET or load_or_create_auth_secret(),
        pair=budget("PAIR", defaults[0].limit, defaults[0].seconds),
        account=budget("ACCOUNT", defaults[1].limit, defaults[1].seconds),
        ip=budget("IP", defaults[2].limit, defaults[2].seconds),
    )


def build_login_throttle() -> LoginThrottle:
    return _build_auth_throttle(
        "LOGIN", (AttemptBudget(5, 60), AttemptBudget(20, 300), AttemptBudget(300, 60))
    )


def build_registration_throttle() -> LoginThrottle:
    return _build_auth_throttle(
        "REGISTER", (AttemptBudget(5, 600), AttemptBudget(10, 600), AttemptBudget(60, 600))
    )
