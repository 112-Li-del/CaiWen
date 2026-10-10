"""Campus server policy. Retained modules remain available to local SDK/CLI."""

from fastapi import HTTPException
from starlette.requests import HTTPConnection
from starlette.responses import JSONResponse
from starlette.websockets import WebSocket

from deeptutor.runtime.campus_policy import campus_request


def needs_admin(path: str, method: str, websocket: bool = False) -> bool:
    path = path.rstrip("/") or "/"
    if websocket:
        return path != "/api/v1/ws"
    prefixes = (
        "/docs", "/redoc", "/openapi.json", "/api/outputs",
        "/api/v1/chat", "/api/v1/solve", "/api/v1/question",
        "/api/v1/book", "/api/v1/co_writer", "/api/v1/notebook",
        "/api/v1/question-notebook", "/api/v1/skills", "/api/v1/memory",
        "/api/v1/tutorbot", "/api/v1/agent-config", "/api/v1/system",
        "/api/v1/dashboard",
    )
    if any(path == prefix or path.startswith(prefix + "/") for prefix in prefixes):
        return True
    if path.startswith("/api/v1/plugins"):
        return not (method == "GET" and path == "/api/v1/plugins/list")
    if path.startswith("/api/v1/settings"):
        allowed = {
            ("GET", "/api/v1/settings"),
            ("GET", "/api/v1/settings/llm-options"),
            ("GET", "/api/v1/settings/themes"),
            ("GET", "/api/v1/settings/sidebar"),
            ("PUT", "/api/v1/settings/theme"),
            ("PUT", "/api/v1/settings/language"),
            ("PUT", "/api/v1/settings/ui"),
            ("POST", "/api/v1/settings/reset"),
        }
        return (method, path) not in allowed
    if path.startswith("/api/v1/knowledge"):
        if method != "GET":
            return True
        relative = path.removeprefix("/api/v1/knowledge").strip("/")
        parts = relative.split("/")
        # Keep selection and previews; the handlers enforce existing KB grants.
        if relative in {"list", "default"}:
            return False
        if parts[0] in {"health", "rag-providers", "supported-file-types", "configs", "tasks"}:
            return True
        return len(parts) > 1 and parts[1] != "files"
    return False


class CampusAccessMiddleware:
    """Enforce authentication and roles on HTTP, WebSocket and static mounts."""

    def __init__(self, app, allowed_origins):
        self.app = app
        self.allowed_origins = frozenset(allowed_origins)

    async def __call__(self, scope, receive, send):
        if scope["type"] not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return
        path = scope["path"].rstrip("/") or "/"
        method = scope.get("method", "GET")
        public = {
            ("GET", "/"),
            ("GET", "/api/v1/auth/status"),
            ("GET", "/api/v1/auth/is_first_user"),
            ("POST", "/api/v1/auth/login"),
            ("POST", "/api/v1/auth/logout"),
            ("POST", "/api/v1/auth/register"),
        }
        if scope["type"] == "http" and (method == "OPTIONS" or (method, path) in public):
            await self.app(scope, receive, send)
            return
        from deeptutor.api.routers import auth
        from deeptutor.multi_user.context import get_current_user, reset_current_user, set_current_user

        connection = HTTPConnection(scope)
        context_token = set_current_user(get_current_user())
        policy_token = campus_request.set(True)
        try:
            # CORS middleware only covers HTTP. Browser WebSocket handshakes
            # need their own Origin check before cookies can authorize a connection.
            origin = connection.headers.get("origin")
            if scope["type"] == "websocket" and origin is not None and origin not in self.allowed_origins:
                raise HTTPException(403, "该网页来源无权连接校园服务。")
            authorization = connection.headers.get("authorization")
            cookie = connection.cookies.get("dt_token")
            if scope["type"] == "websocket" and connection.query_params.get("token"):
                authorization = f"Bearer {connection.query_params['token']}"
            payload = await auth.require_auth(authorization=authorization, dt_token=cookie)
            if payload is not None and payload.role not in {"admin", "user"}:
                raise HTTPException(403, "账号尚未获得使用权限。")
            if scope["type"] == "websocket" and (
                path in {"/api/v1/chat", "/api/v1/solve", "/api/v1/vision/solve"}
                or path.startswith("/api/v1/question/")
            ):
                raise HTTPException(403, "校园服务未开放此旧版执行入口，请使用校园聊天。")
            if needs_admin(path, method, scope["type"] == "websocket"):
                auth.require_admin(payload)
            await self.app(scope, receive, send)
        except HTTPException as exc:
            if scope["type"] == "websocket":
                await WebSocket(scope, receive=receive, send=send).close(
                    code=4001 if exc.status_code == 401 else 4003,
                    reason="请先登录。" if exc.status_code == 401 else "没有访问权限。",
                )
            else:
                await JSONResponse(
                    {"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers
                )(scope, receive, send)
        finally:
            campus_request.reset(policy_token)
            reset_current_user(context_token)
