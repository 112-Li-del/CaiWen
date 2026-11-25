"""
Authentication service for DeepTutor.

Disabled by default (AUTH_ENABLED=false) so localhost users are unaffected.
When enabled, guards all API routes with server-side sessions.

Quick setup (single user via env vars):
    1. Set AUTH_ENABLED=true in .env
    2. Set AUTH_USERNAME=<your username>
    3. Generate a password hash:
           python -c "from deeptutor.services.auth import hash_password; print(hash_password('yourpassword'))"
       Paste the output into AUTH_PASSWORD_HASH=<hash>

Multi-user setup (recommended):
    Enable AUTH_ENABLED=true and leave AUTH_USERNAME/AUTH_PASSWORD_HASH empty.
    Navigate to /register in the browser. The first user to register is granted
    admin privileges and can manage other users from /admin/users.

    Users are stored in data/user/auth_users.json:
        {
            "alice": {"hash": "$2b$12$...", "role": "admin", "created_at": "2026-..."},
            "bob":   {"hash": "$2b$12$...", "role": "user",  "created_at": "2026-..."}
        }
"""

from dataclasses import dataclass
from datetime import datetime, timezone
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration — read once at import time
# ---------------------------------------------------------------------------

AUTH_ENABLED: bool = os.getenv("AUTH_ENABLED", "false").lower() == "true"
AUTH_USERNAME: str = os.getenv("AUTH_USERNAME", "admin")
AUTH_PASSWORD_HASH: str = os.getenv("AUTH_PASSWORD_HASH", "")
AUTH_SECRET: str = os.getenv("AUTH_SECRET", "")
TOKEN_EXPIRE_HOURS: int = int(os.getenv("AUTH_TOKEN_EXPIRE_HOURS", "24"))

# PocketBase auth mode — active when POCKETBASE_URL is set AND AUTH_ENABLED=true.
# Login/register proxy to PocketBase. Its credential is kept on the server and
# validated through PocketBase's cached auth-refresh endpoint.
POCKETBASE_URL: str = os.getenv("POCKETBASE_URL", "").rstrip("/")
POCKETBASE_ENABLED: bool = bool(POCKETBASE_URL) and AUTH_ENABLED

@dataclass
class TokenPayload:
    """Authenticated account identity."""

    username: str
    role: str
    user_id: str = ""


# ---------------------------------------------------------------------------
# Password hashing — uses bcrypt directly (passlib is unmaintained for bcrypt 4+)
# ---------------------------------------------------------------------------


def hash_password(plain: str) -> str:
    """Hash a plaintext password. Use this to generate password hashes."""
    import bcrypt

    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plaintext password against a stored bcrypt hash."""
    import bcrypt

    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


# ---------------------------------------------------------------------------
# User store — JSON file takes priority over env vars
# ---------------------------------------------------------------------------


def _make_user_record(hashed: str, role: str = "user", created_at: str = "") -> dict[str, Any]:
    """Build a canonical user record dict for legacy callers/tests."""
    from deeptutor.multi_user.identity import new_user_id

    return {
        "id": new_user_id(),
        "hash": hashed,
        "role": role,
        "created_at": created_at or datetime.now(timezone.utc).isoformat(),
        "disabled": False,
        "status": "active",
    }


def _load_users() -> dict[str, dict]:
    """
    Load the user store, migrating old flat format if needed.

    Priority:
      1. data/user/auth_users.json — multi-user file
      2. AUTH_USERNAME + AUTH_PASSWORD_HASH env vars — single-user fallback

    Old format: {"alice": "$2b$12$..."}
    New format: {"alice": {"hash": "...", "role": "admin", "created_at": "..."}}
    """
    from deeptutor.multi_user.identity import load_users

    return load_users(AUTH_USERNAME, AUTH_PASSWORD_HASH)


def is_first_user() -> bool:
    """Return True when no users exist yet (first registration will become admin)."""
    return len(_load_users()) == 0


def add_user(username: str, plain_password: str, role: str = "user", status: str = "active", *, create_only: bool = False) -> None:
    """
    Add or update a user in data/user/auth_users.json.

    The role defaults to 'user'. Pass role='admin' to elevate. When the store
    is empty the first user is automatically promoted to 'admin' regardless of
    the role argument.

    status: 'active' (default) or 'pending' — pending users cannot log in until
    approved by an admin.

    Creates the file (and parent directories) if they don't exist.
    """
    from deeptutor.multi_user.identity import save_user

    record = save_user(username, hash_password(plain_password), role=role, status=status, create_only=create_only)  # type: ignore[arg-type]
    logger.info("User '%s' saved with role=%r status=%s", username, record.get("role", "user"), status)


def list_users() -> list[dict]:
    """Return a list of user info dicts (username, role, created_at) — no hashes."""
    from deeptutor.multi_user.identity import list_user_info

    return list_user_info(AUTH_USERNAME, AUTH_PASSWORD_HASH)


def delete_user(username: str) -> bool:
    """
    Remove a user from the store. Returns True if the user existed.

    Note: env-var-only users cannot be deleted via this function.
    """
    from deeptutor.multi_user.identity import delete_user as _delete_user

    if not _delete_user(username):
        return False
    logger.info("User '%s' deleted", username)
    return True


def set_role(username: str, role: str) -> bool:
    """
    Change the role for an existing user. Returns True on success.

    Valid roles: 'admin', 'user'.
    """
    if role not in ("admin", "user"):
        raise ValueError(f"Invalid role: {role!r}. Must be 'admin' or 'user'.")

    from deeptutor.multi_user.identity import set_role as _set_role

    if not _set_role(username, role):  # type: ignore[arg-type]
        return False
    logger.info(f"User '{username}' role updated to {role!r}")
    return True


def approve_user(username: str) -> bool:
    """Approve a pending user — set their status to 'active'."""
    from deeptutor.multi_user.identity import approve_user as _approve_user

    if not _approve_user(username):
        return False
    logger.info("User '%s' approved", username)
    return True


def reject_user(username: str) -> bool:
    """Reject a pending user — delete their record."""
    from deeptutor.multi_user.identity import reject_user as _reject_user

    if not _reject_user(username):
        return False
    logger.info("User '%s' rejected", username)
    return True


# ---------------------------------------------------------------------------
# Server-side login sessions
# ---------------------------------------------------------------------------


def create_token(
    username: str, role: str = "user", user_id: str | None = None,
    *, upstream_token: str | None = None,
) -> str:
    """Issue an opaque session ID. Permissions are resolved on each request."""
    from deeptutor.services.auth_sessions import issue

    if not user_id:
        user_id = str((_load_users().get(username) or {}).get("id") or "")
    if not user_id:
        raise ValueError("Cannot create a login session without a user ID")
    return issue(username, user_id, TOKEN_EXPIRE_HOURS * 3600, upstream_token)


def decode_token(token: str) -> TokenPayload | None:
    """Resolve an active session against current account permissions."""
    from deeptutor.services.auth_sessions import lookup

    session = lookup(token)
    if session is None:
        return None
    username, user_id, upstream_token = session
    if POCKETBASE_ENABLED:
        from deeptutor.services.pocketbase_client import validate_pb_token

        payload = validate_pb_token(upstream_token) if upstream_token else None
        if not payload:
            return None
        current_id = str(payload.get("id") or payload.get("uid") or payload.get("user_id") or "")
        role = payload.get("role", "user")
        if current_id != user_id or role not in {"admin", "user"}:
            return None
        return TokenPayload(payload["username"], role, user_id)

    if upstream_token:
        return None
    record = _load_users().get(username)
    if not record or record.get("disabled") or record.get("status", "active") != "active":
        return None
    if record.get("id") != user_id or record.get("role") not in {"admin", "user"}:
        return None
    return TokenPayload(username, record["role"], user_id)


# ---------------------------------------------------------------------------
# PocketBase auth helpers
# ---------------------------------------------------------------------------


def authenticate_pb(username: str, password: str) -> tuple[TokenPayload, str] | None:
    """
    Authenticate against PocketBase and return (TokenPayload, raw_pb_token).

    Only called when POCKETBASE_ENABLED=True.
    Returns None on failure.
    The raw token is the PocketBase JWT string to be stored in the cookie.

    PocketBase requires an email address; plain usernames are mapped to
    <username>@deeptutor.local to match the email used at registration.
    """
    try:
        from deeptutor.services.pocketbase_client import get_pb_client

        pb = get_pb_client()
        result = pb.collection("users").auth_with_password(username, password)
        token: str = result.token
        record = result.record
        username = (
            getattr(record, "email", None)
            or getattr(record, "name", None)
            or getattr(record, "id", "unknown")
        )
        # PocketBase has no built-in "role" field by default; treat all as "user".
        # Admins authenticated via PocketBase admin panel use a separate endpoint.
        role = getattr(record, "role", "user") or "user"
        user_id = str(getattr(record, "id", "") or "")
        return TokenPayload(username=str(username), role=str(role), user_id=user_id), token
    except Exception as exc:
        logger.warning(f"PocketBase authentication failed: {exc}")
        return None


def register_pb(username: str, email: str, password: str) -> dict | None:
    """
    Create a new user in PocketBase.

    Returns the created user record dict or None on failure.
    """
    try:
        from deeptutor.services.pocketbase_client import get_pb_client

        pb = get_pb_client()
        record = pb.collection("users").create(
            {
                "username": username,
                "email": email,
                "password": password,
                "passwordConfirm": password,
            }
        )
        return {"id": record.id, "username": username, "email": email}
    except Exception as exc:
        logger.warning(f"PocketBase registration failed: {exc}")
        return None


# ---------------------------------------------------------------------------
# Main auth entry point
# ---------------------------------------------------------------------------

# A bcrypt work item, never an account credential. Its comparison result must
# never authorize login. Cost 12 matches hash_password's current default.
_DUMMY_PASSWORD_HASH = "$2b$12$jTC8lDifNn6HJWsYh/MHA.KYJKG0FArCrO7cz5ORVHbSYqmlWRPee"


def authenticate(username: str, password: str) -> TokenPayload | None:
    """
    Validate credentials. Returns a TokenPayload on success, None on failure.

    When AUTH_ENABLED=false, always returns a dummy admin payload so that
    callers don't need to special-case the disabled state.
    """
    if not AUTH_ENABLED:
        return TokenPayload(username=username or "local", role="admin", user_id="local-admin")

    users = _load_users()
    if not users:
        logger.warning(
            "No users configured — login will always fail. "
            "Navigate to /register to create your first account."
        )
    record = users.get(username)
    if not record:
        verify_password(password, _DUMMY_PASSWORD_HASH)
        return None

    hashed = record.get("hash", "") if isinstance(record, dict) else record
    if not verify_password(password, hashed):
        return None
    if isinstance(record, dict) and record.get("disabled"):
        return None

    # Reject pending users — must be approved by admin first
    if isinstance(record, dict) and record.get("status") == "pending":
        logger.info("Login attempt rejected: user '%s' is pending approval", username)
        return TokenPayload(username=username, role="pending", user_id="")

    role = record.get("role", "user") if isinstance(record, dict) else "user"
    user_id = str(record.get("id") or "") if isinstance(record, dict) else ""
    return TokenPayload(username=username, role=role, user_id=user_id)
