"""Auth router — login, logout, status, registration, and user-management endpoints."""

from functools import lru_cache
import logging
import os

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response, status
from pydantic import BaseModel, field_validator

# SameSite=None lets the cookie work when the browser accesses the frontend via
# 127.0.0.1 and the backend via localhost (different origins on the same machine).
# Browsers require Secure=True for SameSite=None, but that needs HTTPS — so in
# local dev we fall back to SameSite=Lax and tell users to use localhost:// URLs.
_SECURE = os.getenv("AUTH_COOKIE_SECURE", "false").lower() == "true"
_SAMESITE = "none" if _SECURE else "lax"

# When true (default), accounts created directly by an admin via POST /users
# also receive this instance's default grants immediately. Self-registered
# accounts always receive theirs at approval time (see admin_approve_user).
AUTO_GRANT_ADMIN_CREATED_USERS = (
    os.getenv("AUTO_GRANT_ADMIN_CREATED_USERS", "true").lower() == "true"
)

from deeptutor.services.auth import (
    AUTH_ENABLED,
    POCKETBASE_ENABLED,
    TOKEN_EXPIRE_HOURS,
    TokenPayload,
    add_user,
    approve_user,
    authenticate,
    authenticate_pb,
    create_token,
    decode_token,
    delete_user,
    is_first_user,
    list_users,
    register_pb,
    reject_user,
    set_role,
)

logger = logging.getLogger(__name__)

router = APIRouter()

_COOKIE_NAME = "dt_token"
_COOKIE_MAX_AGE = TOKEN_EXPIRE_HOURS * 3600


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class LoginRequest(BaseModel):
    """Payload for the POST /login endpoint."""

    username: str
    password: str


class RegisterRequest(BaseModel):
    """Payload for the POST /register endpoint."""

    username: str
    password: str

    @field_validator("username")
    @classmethod
    def username_valid(cls, v: str) -> str:
        import re

        v = v.strip()
        if not v:
            raise ValueError("账号不能为空。")
        # Accept standard email addresses (used by PocketBase mode) or plain
        # usernames (used by the built-in SQLite/JSON auth mode).
        email_re = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
        plain_re = re.compile(r"^[A-Za-z0-9_\-.]{3,64}$")
        if not email_re.match(v) and not plain_re.match(v):
            raise ValueError("请输入有效邮箱或由字母、数字、下划线、短横线、点组成的 3 至 64 位账号。")
        return v

    @field_validator("password")
    @classmethod
    def password_valid(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("密码至少需要 8 个字符。")
        return v


class SetRoleRequest(BaseModel):
    """Payload for the PUT /users/{username}/role endpoint."""

    role: str

    @field_validator("role")
    @classmethod
    def role_valid(cls, v: str) -> str:
        if v not in ("admin", "user"):
            raise ValueError("Role must be 'admin' or 'user'")
        return v


class AuthStatusResponse(BaseModel):
    """Response body for the GET /status endpoint."""

    enabled: bool
    authenticated: bool
    user_id: str | None = None
    username: str | None = None
    role: str | None = None
    is_admin: bool = False
    is_super_admin: bool = False
    member_type: str | None = None


class UserInfo(BaseModel):
    """Single user record returned by the GET /users endpoint."""

    id: str = ""
    username: str
    role: str
    created_at: str
    disabled: bool = False
    status: str = "active"
    is_super_admin: bool = False
    member_type: str | None = None


class MemberTypeRequest(BaseModel):
    member_type: str

    @field_validator("member_type")
    @classmethod
    def valid_type(cls, value: str) -> str:
        if value not in {"student", "teacher"}:
            raise ValueError("身份必须为学生或教师")
        return value


def is_super_admin(payload: TokenPayload | None) -> bool:
    if not AUTH_ENABLED:
        return True
    if not payload or payload.role != "admin":
        return False
    from deeptutor.multi_user.identity import get_user
    record = get_user(payload.username)
    return bool(record and record.get("is_super_admin") and record.get("id") == payload.user_id)


def check_manage_target(current: TokenPayload | None, username: str) -> None:
    from deeptutor.multi_user.identity import get_user
    target = get_user(username)
    if target and (target.get("is_super_admin") or
                   (target.get("role") == "admin" and not is_super_admin(current))):
        raise HTTPException(status_code=403, detail="无权修改该管理员账号")


# ---------------------------------------------------------------------------
# Shared helper — extract token from cookie or Bearer header
# ---------------------------------------------------------------------------


def _bearer_token_from_header(authorization: str | None) -> str | None:
    """Parse ``Authorization: Bearer <token>`` without using ``HTTPBearer``.

    ``HTTPBearer`` is a class-based dependency whose ``__call__`` is annotated
    ``request: Request``. FastAPI doesn't inject a Request into WebSocket
    dependency resolution, which makes ``HTTPBearer`` raise ``TypeError`` the
    moment a router with this dep mounts a WS endpoint. Doing the parse by
    hand keeps ``require_auth`` HTTP/WS-symmetric.
    """
    if not authorization:
        return None
    parts = authorization.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        token = parts[1].strip()
        return token or None
    return None


def _extract_token(authorization: str | None, dt_token: str | None) -> str | None:
    return _bearer_token_from_header(authorization) or dt_token


# ---------------------------------------------------------------------------
# Dependencies — reusable auth guards for other routers
# ---------------------------------------------------------------------------


async def require_auth(
    authorization: str | None = Header(default=None, alias="Authorization"),
    dt_token: str | None = Cookie(default=None),
) -> TokenPayload | None:
    """
    FastAPI dependency that enforces authentication when AUTH_ENABLED=true.

    Accepts the JWT from either:
      - Authorization: Bearer <token> header
      - dt_token cookie

    Works on both HTTP and WebSocket routes — ``Header`` and ``Cookie`` are
    WS-compatible, while ``HTTPBearer`` (which we used to use here) is not.

    Returns the authenticated TokenPayload, or None if auth is disabled.
    Raises HTTP 401 if auth is enabled but the token is missing or invalid.
    """
    if not AUTH_ENABLED:
        from deeptutor.multi_user.context import set_current_user
        from deeptutor.multi_user.paths import local_admin_user

        set_current_user(local_admin_user())
        return None

    token = _extract_token(authorization, dt_token)

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="请先登录。",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录已失效，请重新登录。",
            headers={"WWW-Authenticate": "Bearer"},
        )

    from deeptutor.multi_user.context import set_current_user, user_from_token_payload

    if payload.role not in {"admin", "user"}:
        raise HTTPException(status_code=403, detail="账号尚未获得使用权限。")
    set_current_user(user_from_token_payload(payload))
    return payload


def require_admin(
    payload: TokenPayload | None = Depends(require_auth),
) -> TokenPayload:
    """
    FastAPI dependency that requires the caller to be an admin.

    Raises HTTP 403 if the authenticated user is not an admin.
    When AUTH_ENABLED=false, all requests are treated as admin.
    """
    if not AUTH_ENABLED:
        from deeptutor.services.auth import TokenPayload as TP

        return TP(username="local", role="admin", user_id="local-admin")

    if payload is None or payload.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="此功能仅限管理员使用。",
        )
    return payload


# ---------------------------------------------------------------------------
# Public endpoints (no auth required)
# ---------------------------------------------------------------------------


@router.get("/status", response_model=AuthStatusResponse)
async def auth_status(
    authorization: str | None = Header(default=None, alias="Authorization"),
    dt_token: str | None = Cookie(default=None),
) -> AuthStatusResponse:
    """Return whether auth is enabled and whether the current request is authenticated."""
    if not AUTH_ENABLED:
        return AuthStatusResponse(
            enabled=False,
            authenticated=True,
            user_id="local-admin",
            username="local",
            role="admin",
            is_admin=True,
            is_super_admin=True,
        )

    token = _extract_token(authorization, dt_token)
    payload = decode_token(token) if token else None
    from deeptutor.multi_user.identity import get_user
    record = get_user(payload.username) if payload and not POCKETBASE_ENABLED else None
    return AuthStatusResponse(
        enabled=True,
        authenticated=payload is not None,
        user_id=payload.user_id if payload else None,
        username=payload.username if payload else None,
        role=payload.role if payload else None,
        is_admin=payload.role == "admin" if payload else False,
        is_super_admin=is_super_admin(payload) if payload else False,
        member_type=record.get("member_type") if record else None,
    )


@lru_cache(maxsize=1)
def _get_login_throttle():
    from deeptutor.services.login_throttle import build_login_throttle

    return build_login_throttle()


def enforce_login_budget(body: LoginRequest, request: Request) -> None:
    """Run in FastAPI's thread pool before either authentication backend.

    Use ASGI's client address; never trust arbitrary forwarded headers here.
    Configure the server's trusted proxy list when deploying behind a proxy.
    """
    if not AUTH_ENABLED:
        return
    client_ip = request.client.host if request.client else "unknown"
    username = body.username
    if POCKETBASE_ENABLED:
        username = username.strip().casefold()
    try:
        retry_after = _get_login_throttle().reserve(username, client_ip)
    except Exception as exc:
        # Fail closed if the shared store is locked/corrupt; do not silently
        # allow unlimited password checks or expose database details.
        logger.error("Login throttle unavailable: %s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="登录服务暂时不可用，请稍后重试。",
            headers={"Retry-After": "30"},
        ) from exc
    if retry_after:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"登录尝试次数过多，请在 {retry_after} 秒后重试。",
            headers={"Retry-After": str(retry_after)},
        )


@router.post("/login", dependencies=[Depends(enforce_login_budget)])
async def login(body: LoginRequest, response: Response) -> dict:
    """Validate credentials and set a JWT cookie."""
    if not AUTH_ENABLED:
        return {"ok": True, "message": "当前未启用身份认证，无需登录。"}

    if POCKETBASE_ENABLED:
        # PocketBase mode: email = username field for backwards-compat with the
        # existing LoginRequest schema; users can pass their email as "username".
        pb_result = authenticate_pb(body.username, body.password)
        if not pb_result:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="邮箱或密码错误。",
            )
        payload, pb_token = pb_result
        response.set_cookie(
            key=_COOKIE_NAME,
            value=pb_token,
            httponly=True,
            samesite=_SAMESITE,
            max_age=_COOKIE_MAX_AGE,
            secure=_SECURE,
        )
        logger.info(f"User '{payload.username}' logged in via PocketBase (role={payload.role!r})")
        return {
            "ok": True,
            "user_id": payload.user_id,
            "username": payload.username,
            "role": payload.role,
            "is_admin": payload.role == "admin",
        }

    # Standard JWT + bcrypt mode
    result = authenticate(body.username, body.password)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误。",
        )
    if result.role == "pending":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="你的账号正在等待审核，请等待管理员审核通过后再登录。",
        )

    token = create_token(result.username, result.role, result.user_id)
    response.set_cookie(
        key=_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite=_SAMESITE,
        max_age=_COOKIE_MAX_AGE,
        secure=_SECURE,
    )

    logger.info(f"User '{result.username}' logged in (role={result.role!r})")
    return {
        "ok": True,
        "user_id": result.user_id,
        "username": result.username,
        "role": result.role,
        "is_admin": result.role == "admin",
    }


@router.post("/logout")
async def logout(response: Response) -> dict:
    """Clear the JWT cookie."""
    response.delete_cookie(key=_COOKIE_NAME, samesite=_SAMESITE)
    return {"ok": True}


@lru_cache(maxsize=1)
def _get_registration_throttle():
    from deeptutor.services.login_throttle import build_registration_throttle

    return build_registration_throttle()


def enforce_registration_budget(body: RegisterRequest, request: Request) -> None:
    """Limit every valid registration request before checking account existence."""
    if not AUTH_ENABLED:
        return
    client_ip = request.client.host if request.client else "unknown"
    username = body.username.strip().casefold() if POCKETBASE_ENABLED else body.username
    try:
        retry_after = _get_registration_throttle().reserve(username, client_ip)
    except Exception as exc:
        logger.error("Registration throttle unavailable: %s", type(exc).__name__)
        raise HTTPException(
            status_code=503,
            detail="注册服务暂时不可用，请稍后重试。",
            headers={"Retry-After": "30"},
        ) from exc
    if retry_after:
        raise HTTPException(
            status_code=429,
            detail=f"注册尝试次数过多，请在 {retry_after} 秒后重试。",
            headers={"Retry-After": str(retry_after)},
        )


@router.post("/register", status_code=status.HTTP_201_CREATED, dependencies=[Depends(enforce_registration_budget)])
async def register(body: RegisterRequest) -> dict:
    """
    Self-registration with admin approval.

    Anyone can register. The first user is automatically activated as admin.
    Subsequent users are created with ``status=pending`` and must be approved
    by an admin via ``POST /api/v1/auth/users/{username}/approve`` before
    they can log in.

    Only available when AUTH_ENABLED=true.
    """
    if not AUTH_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="当前未启用身份认证，无法注册。",
        )

    if POCKETBASE_ENABLED:
        # PocketBase deployments are documented as single-user. Keep registration
        # closed and require admins to provision users in the PocketBase admin UI.
        if not is_first_user():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="当前未开放自主注册，请联系管理员创建账号。",
            )
        result = register_pb(username=body.username, email=body.username, password=body.password)
        if not result:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="注册失败，账号或邮箱可能已被注册。",
            )
        logger.info(f"First user registered via PocketBase: '{body.username}'")
        return {
            "ok": True,
            "user_id": result.get("id", ""),
            "username": body.username,
            "role": "user",
            "is_first_user": True,
            "is_admin": False,
            "status": "active",
        }

    # Check for duplicate username
    existing = {u["username"] for u in list_users()}
    if body.username in existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该账号已被注册，请直接登录或使用其他账号。",
        )

    # First user → auto active + admin. Subsequent → pending, wait for approval.
    first_user = is_first_user()
    user_status = "active" if first_user else "pending"

    try:
        add_user(body.username, body.password, status=user_status, create_only=True)
    except ValueError as exc:
        if str(exc) != "USER_ALREADY_EXISTS":
            raise
        raise HTTPException(409, "该账号已被注册，请直接登录或使用其他账号。") from exc
    user_id = ""
    role = "user"
    for item in list_users():
        if item.get("username") == body.username:
            user_id = str(item.get("id") or "")
            role = str(item.get("role") or "user")
            break

    if first_user:
        logger.info(f"First user (admin) registered: '{body.username}'")
    else:
        logger.info(f"User '{body.username}' registered (pending approval)")
        # Grants are applied at activation time (admin_approve_user), not at
        # registration, so they reflect the instance's default config on the
        # day the account is actually approved.

    return {
        "ok": True,
        "user_id": user_id,
        "username": body.username,
        "role": role,
        "is_first_user": first_user,
        "is_admin": role == "admin",
        "status": user_status,
    }


@router.get("/is_first_user")
async def check_is_first_user() -> dict:
    """Return whether the user store is empty (used by the register UI)."""
    return {"is_first_user": is_first_user() if AUTH_ENABLED else False}


# ---------------------------------------------------------------------------
# Admin-only endpoints
# ---------------------------------------------------------------------------


@router.get("/users", response_model=list[UserInfo])
async def get_users(_: TokenPayload = Depends(require_admin)) -> list[UserInfo]:
    """List all registered users. Requires admin role."""
    return [UserInfo(**u) for u in list_users()]


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def admin_create_user(
    body: RegisterRequest,
    current: TokenPayload = Depends(require_admin),
) -> dict:
    """Admin-only: create a new user account.

    Replaces the public ``/register`` flow once the first admin exists. The
    new account is always created with role=``user``; admins can promote
    later via ``PUT /users/{username}/role``.
    """
    if not AUTH_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Auth is disabled — user creation is not available.",
        )

    if POCKETBASE_ENABLED:
        result = register_pb(username=body.username, email=body.username, password=body.password)
        if not result:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Failed to create user — username may already be taken.",
            )
        logger.info(
            f"Admin '{current.username if current else 'local'}' created PocketBase user "
            f"'{body.username}'"
        )
        return {
            "ok": True,
            "user_id": result.get("id", ""),
            "username": body.username,
            "role": "user",
            "is_admin": False,
        }

    existing = {u["username"] for u in list_users()}
    if body.username in existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该账号已被注册，请使用其他账号。",
        )

    try:
        add_user(body.username, body.password, create_only=True)
    except ValueError as exc:
        if str(exc) != "USER_ALREADY_EXISTS":
            raise
        raise HTTPException(409, "该账号已被注册，请使用其他账号。") from exc
    user_id = ""
    role = "user"
    for item in list_users():
        if item.get("username") == body.username:
            user_id = str(item.get("id") or "")
            role = str(item.get("role") or "user")
            break
    logger.info(
        f"Admin '{current.username if current else 'local'}' created user '{body.username}' "
        f"(role={role!r})"
    )
    # Optionally grant this instance's defaults immediately for admin-created
    # accounts. Controlled by AUTO_GRANT_ADMIN_CREATED_USERS (default on) so a
    # deployment can opt out. Self-registered accounts are granted on approval
    # instead (see admin_approve_user).
    if AUTO_GRANT_ADMIN_CREATED_USERS and user_id and role != "admin":
        from deeptutor.multi_user.default_grants import apply_default_grant

        apply_default_grant(user_id)

    return {
        "ok": True,
        "user_id": user_id,
        "username": body.username,
        "role": role,
        "is_admin": role == "admin",
    }


@router.delete("/users/{username}", status_code=status.HTTP_200_OK)
async def remove_user(
    username: str,
    current: TokenPayload = Depends(require_admin),
) -> dict:
    """Delete a user. Admins cannot delete their own account."""
    if current and username == current.username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account",
        )

    check_manage_target(current, username)
    removed = delete_user(username)
    if not removed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    logger.info(f"Admin '{current.username if current else 'local'}' deleted user '{username}'")
    return {"ok": True}


@router.post("/users/{username}/approve", status_code=status.HTTP_200_OK)
async def admin_approve_user(
    username: str,
    current: TokenPayload = Depends(require_admin),
) -> dict:
    """Approve a pending user — activates their account so they can log in."""
    check_manage_target(current, username)
    if current and username == current.username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot approve your own account",
        )

    if not approve_user(username):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found or not in pending state",
        )

    # approve_user() only returns True when the account actually transitioned
    # pending → active, so the block below runs exactly once per activation.
    # Apply the instance's default grants at activation time (not registration)
    # so the account immediately has the configured models / public KBs.
    from deeptutor.multi_user.default_grants import apply_default_grant
    from deeptutor.multi_user.identity import get_user as _identity_get_user

    _record = _identity_get_user(username) or {}
    _user_id = str(_record.get("id") or "")
    if _user_id:
        apply_default_grant(_user_id)

    logger.info(
        f"Admin '{current.username if current else 'local'}' approved user '{username}'"
    )
    return {"ok": True, "username": username, "status": "active"}


@router.post("/users/{username}/reject", status_code=status.HTTP_200_OK)
async def admin_reject_user(
    username: str,
    current: TokenPayload = Depends(require_admin),
) -> dict:
    """Reject a pending user — permanently deletes their account."""
    check_manage_target(current, username)
    if current and username == current.username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot reject your own account",
        )

    if not reject_user(username):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found or not in pending state",
        )

    logger.info(
        f"Admin '{current.username if current else 'local'}' rejected user '{username}'"
    )
    return {"ok": True, "username": username, "status": "rejected"}


@router.put("/users/{username}/role", status_code=status.HTTP_200_OK)
async def update_user_role(
    username: str,
    body: SetRoleRequest,
    current: TokenPayload = Depends(require_admin),
) -> dict:
    """Change a user's role. Admins cannot change their own role."""
    if not is_super_admin(current):
        raise HTTPException(status_code=403, detail="只有最高管理员可以任命或撤销管理员")
    check_manage_target(current, username)
    if current and username == current.username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot change your own role",
        )

    updated = set_role(username, body.role)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    logger.info(
        f"Admin '{current.username if current else 'local'}' set '{username}' role to {body.role!r}"
    )
    return {"ok": True, "username": username, "role": body.role}


@router.put("/users/{username}/member-type")
async def update_member_type(
    username: str,
    body: MemberTypeRequest,
    current: TokenPayload = Depends(require_admin),
) -> dict:
    check_manage_target(current, username)
    from deeptutor.multi_user.identity import get_user
    target = get_user(username)
    if target and target.get("role") == "admin":
        raise HTTPException(status_code=403, detail="管理员拥有全部权限，无需分配学生或教师身份")
    from deeptutor.multi_user.identity import set_member_type
    if not set_member_type(username, body.member_type):
        raise HTTPException(status_code=404, detail="用户不存在")
    from deeptutor.multi_user.audit import log_admin_action
    log_admin_action("member_type_set", summary={"username": username, "member_type": body.member_type})
    return {"ok": True, "member_type": body.member_type}
