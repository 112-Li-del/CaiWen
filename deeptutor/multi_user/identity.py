"""Canonical identity store for the optional multi-user layer."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import secrets
import threading
import os
import tempfile
import shutil
from typing import Any
from uuid import uuid4
from functools import wraps

from .models import Role

logger = logging.getLogger(__name__)

# Serialises writes to USERS_FILE so a concurrent burst of /register requests
# cannot all see ``not users`` and each promote themselves to admin. Single-
# process FastAPI deployments (the start_web.py launcher) are fully covered;
# multi-worker deployments still race and must rely on an external user store
# (e.g. PocketBase), which is documented in the multi-user README.
_USERS_WRITE_LOCK = threading.RLock()

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MULTI_USER_ROOT = PROJECT_ROOT / "multi-user"
SYSTEM_ROOT = MULTI_USER_ROOT / "_system"
AUTH_DIR = SYSTEM_ROOT / "auth"
USERS_FILE = AUTH_DIR / "users.json"
SECRET_FILE = AUTH_DIR / "auth_secret"
LEGACY_USERS_FILE = PROJECT_ROOT / "data" / "user" / "auth_users.json"
LEGACY_SECRET_FILE = PROJECT_ROOT / "data" / "user" / "auth_secret"


def _locked(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        with _USERS_WRITE_LOCK:
            return fn(*args, **kwargs)
    return wrapper


def new_user_id() -> str:
    return f"u_{uuid4().hex}"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _canonical_record(
    username: str,
    value: Any,
    *,
    default_role: Role = "user",
) -> dict[str, Any] | None:
    if isinstance(value, str):
        return {
            "id": new_user_id(),
            "hash": value,
            "role": default_role,
            "created_at": utc_now(),
            "disabled": False,
            "status": "active",
        }
    if not isinstance(value, dict):
        return None
    hashed = str(value.get("hash") or value.get("password_hash") or "")
    if not hashed:
        return None
    role = str(value.get("role") or default_role)
    if role not in {"admin", "user"}:
        role = default_role
    status = str(value.get("status") or "active")
    if status not in ("active", "pending"):
        status = "active"
    return {
        "id": str(value.get("id") or new_user_id()),
        "hash": hashed,
        "role": role,
        "created_at": str(value.get("created_at") or utc_now()),
        "disabled": bool(value.get("disabled", False)),
        "status": status,
        "is_super_admin": bool(value.get("is_super_admin", False)) if role == "admin" else False,
        "member_type": value.get("member_type") if role == "user" and value.get("member_type") in {"student", "teacher"} else None,
    }


def _read_json(path: Path) -> dict[str, Any]:
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
        return loaded if isinstance(loaded, dict) else {}
    except Exception as exc:
        logger.warning("Failed to read %s: %s", path, exc)
        return {}


def _write_users(users: dict[str, dict[str, Any]]) -> None:
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=USERS_FILE.parent, prefix=".users-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(users, handle, indent=2, ensure_ascii=False)
        os.replace(temporary, USERS_FILE)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _migrate_legacy_users() -> dict[str, dict[str, Any]] | None:
    if USERS_FILE.exists() or not LEGACY_USERS_FILE.exists():
        return None
    legacy = _read_json(LEGACY_USERS_FILE)
    users: dict[str, dict[str, Any]] = {}
    for username, value in legacy.items():
        role: Role = "admin" if not users else "user"
        if isinstance(value, dict) and str(value.get("role") or "") in {"admin", "user"}:
            role = str(value.get("role"))  # type: ignore[assignment]
        record = _canonical_record(username, value, default_role=role)
        if record is not None:
            users[str(username)] = record
    if users:
        candidates = [(name, item) for name, item in users.items() if item["role"] == "admin"]
        if candidates:
            owner, _ = min(candidates, key=lambda pair: (pair[1].get("created_at") or "9999", pair[0]))
            users[owner]["is_super_admin"] = True
        _write_users(users)
        logger.info("Migrated auth users from %s to %s", LEGACY_USERS_FILE, USERS_FILE)
        return users
    return None


def _migrate_secret() -> None:
    if SECRET_FILE.exists() or not LEGACY_SECRET_FILE.exists():
        return
    try:
        secret = LEGACY_SECRET_FILE.read_text(encoding="utf-8").strip()
        if secret:
            SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
            SECRET_FILE.write_text(secret, encoding="utf-8")
            try:
                SECRET_FILE.chmod(0o600)
            except OSError:
                pass
            logger.info("Migrated auth secret from %s to %s", LEGACY_SECRET_FILE, SECRET_FILE)
    except Exception as exc:
        logger.warning("Failed to migrate legacy auth secret: %s", exc)


@_locked
def load_users(  # nosec B107 - empty defaults mean "no env fallback supplied".
    env_username: str = "",
    env_password_hash: str = "",
) -> dict[str, dict[str, Any]]:
    """Load canonical users, migrating legacy records and env fallback in memory."""
    users: dict[str, dict[str, Any]] | None = None
    if USERS_FILE.exists():
        users = _read_json(USERS_FILE)
    else:
        users = _migrate_legacy_users()

    if users is None:
        users = {}

    canonical: dict[str, dict[str, Any]] = {}
    changed = False
    for index, (username, value) in enumerate(users.items()):
        role: Role = "admin" if index == 0 else "user"
        if isinstance(value, dict) and str(value.get("role") or "") in {"admin", "user"}:
            role = str(value.get("role"))  # type: ignore[assignment]
        record = _canonical_record(str(username), value, default_role=role)
        if record is None:
            changed = True
            continue
        canonical[str(username)] = record
        changed = changed or record != value

    if USERS_FILE.exists() and canonical and not any(
        isinstance(item, dict) and "is_super_admin" in item for item in users.values()
    ):
        candidates = [(name, item) for name, item in canonical.items()
                      if item["role"] == "admin" and not item["disabled"] and item["status"] == "active"]
        if candidates:
            owner, _ = min(candidates, key=lambda pair: (pair[1].get("created_at") or "9999", pair[0]))
            backup = USERS_FILE.with_name("users.pre-hierarchy.json")
            if not backup.exists():
                shutil.copy2(USERS_FILE, backup)
            canonical[owner]["is_super_admin"] = True
            changed = True
    if USERS_FILE.exists() and changed:
        _write_users(canonical)

    if canonical:
        return canonical

    if env_username and env_password_hash:
        return {
            env_username: {
                "id": "env-admin",
                "hash": env_password_hash,
                "role": "admin",
                "created_at": "",
                "disabled": False,
            }
        }

    return {}


def save_user(
    username: str,
    hashed_password: str,
    role: Role = "user",
    status: str = "active",
    *,
    create_only: bool = False,
) -> dict[str, Any]:
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    # Read-modify-write must be atomic so concurrent first-time registrations
    # cannot each see an empty store and each promote themselves to admin.
    with _USERS_WRITE_LOCK:
        users = load_users()
        if create_only and username in users:
            raise ValueError("USER_ALREADY_EXISTS")
        existing = users.get(username) or {}
        effective_role: Role = "admin" if not users or existing.get("is_super_admin") else role
        record = {
            "id": str(existing.get("id") or new_user_id()),
            "hash": hashed_password,
            "role": effective_role,
            "created_at": str(existing.get("created_at") or utc_now()),
            "disabled": bool(existing.get("disabled", False)),
            "status": status,
            "is_super_admin": bool(existing.get("is_super_admin", False)) if users else True,
            "member_type": existing.get("member_type") if effective_role == "user" else None,
        }
        users[username] = record
        _write_users(users)
    return record


def list_user_info(  # nosec B107 - empty defaults mean "no env fallback supplied".
    env_username: str = "",
    env_password_hash: str = "",
) -> list[dict[str, Any]]:
    return [
        {
            "id": record.get("id", ""),
            "username": username,
            "role": record.get("role", "user"),
            "created_at": record.get("created_at", ""),
            "disabled": bool(record.get("disabled", False)),
            "status": str(record.get("status") or "active"),
            "is_super_admin": bool(record.get("is_super_admin", False)),
            "member_type": record.get("member_type"),
        }
        for username, record in load_users(env_username, env_password_hash).items()
    ]


def get_user(username: str) -> dict[str, Any] | None:
    return load_users().get(username)


def get_user_by_id(user_id: str) -> tuple[str, dict[str, Any]] | None:
    for username, record in load_users().items():
        if str(record.get("id") or "") == user_id:
            return username, record
    return None


@_locked
def delete_user(username: str) -> bool:
    if not USERS_FILE.exists():
        return False
    users = load_users()
    if username not in users:
        return False
    if users[username].get("is_super_admin"):
        raise ValueError("最高管理员不能删除")
    users.pop(username, None)
    _write_users(users)
    return True


@_locked
def set_role(username: str, role: Role) -> bool:
    if role not in {"admin", "user"}:
        raise ValueError("role must be 'admin' or 'user'")
    if not USERS_FILE.exists():
        return False
    users = load_users()
    if username not in users:
        return False
    if users[username].get("is_super_admin"):
        raise ValueError("最高管理员不能降级")
    users[username]["role"] = role
    if role == "admin":
        users[username]["member_type"] = None
    _write_users(users)
    return True


@_locked
def approve_user(username: str) -> bool:
    """Approve a pending user — set their status to 'active'."""
    if not USERS_FILE.exists():
        return False
    users = load_users()
    if username not in users:
        return False
    if users[username].get("status") != "pending":
        return False
    users[username]["status"] = "active"
    _write_users(users)
    logger.info("User '%s' approved (status → active)", username)
    return True


@_locked
def reject_user(username: str) -> bool:
    """Reject a pending user — delete their record entirely."""
    if not USERS_FILE.exists():
        return False
    users = load_users()
    if username not in users:
        return False
    if users[username].get("status") != "pending":
        return False
    users.pop(username, None)
    _write_users(users)
    logger.info("User '%s' rejected and removed", username)
    return True


def load_or_create_auth_secret() -> str:
    _migrate_secret()
    try:
        if SECRET_FILE.exists():
            existing = SECRET_FILE.read_text(encoding="utf-8").strip()
            if existing:
                return existing
        SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
        generated = secrets.token_hex(32)
        SECRET_FILE.write_text(generated, encoding="utf-8")
        try:
            SECRET_FILE.chmod(0o600)
        except OSError:
            pass
        logger.warning(
            "AUTH_ENABLED=true but AUTH_SECRET is not set. Generated a stable local secret at %s.",
            SECRET_FILE,
        )
        return generated
    except Exception as exc:
        logger.warning("Failed to load/create auth secret at %s: %s", SECRET_FILE, exc)
        return secrets.token_hex(32)


def set_member_type(username: str, member_type: str) -> bool:
    if member_type not in {"student", "teacher"}:
        raise ValueError("身份必须为学生或教师")
    with _USERS_WRITE_LOCK:
        users = load_users()
        if username not in users:
            return False
        if users[username].get("role") == "admin":
            raise ValueError("管理员拥有全部权限，无需分配学生或教师身份")
        users[username]["member_type"] = member_type
        _write_users(users)
    return True
