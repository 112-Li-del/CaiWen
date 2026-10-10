"""Security regressions against the assembled campus app (no lifespan/LLM calls)."""

import pytest
import asyncio
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from deeptutor.api import main
from deeptutor.api.routers import auth
from deeptutor.multi_user import paths
from deeptutor.services.auth import TokenPayload
from deeptutor.services import auth as auth_service


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(auth, "AUTH_ENABLED", True)
    monkeypatch.setattr(auth_service, "AUTH_ENABLED", True)
    monkeypatch.setattr(paths, "MULTI_USER_ROOT", tmp_path)
    monkeypatch.setattr(paths, "_path_services", {})
    monkeypatch.setattr(paths, "ensure_user_workspace", lambda uid: tmp_path / uid)
    monkeypatch.setattr(auth, "is_first_user", lambda: False)
    identities = {
        "student": TokenPayload("student", "user", "u_student"),
        "admin": TokenPayload("admin", "admin", "u_admin"),
        "pending": TokenPayload("pending", "pending", "u_pending"),
        "other": TokenPayload("other", "user", "u_other"),
    }
    monkeypatch.setattr(auth, "decode_token", lambda token: identities.get(token))
    monkeypatch.setattr(auth_service, "decode_token", lambda token: identities.get(token))
    # Do not enter TestClient's context: production lifespan starts models/bots.
    instance = TestClient(main.app)
    yield instance
    instance.close()


@pytest.mark.parametrize("method,path", [
    ("GET", "/openapi.json"), ("GET", "/docs"), ("GET", "/redoc"),
    ("GET", "/api/v1/system/status"), ("GET", "/api/v1/system/runtime-topology"),
    ("GET", "/api/v1/auth/users"), ("GET", "/api/v1/book/books"),
    ("GET", "/api/v1/tutorbot"), ("GET", "/api/v1/skills/list"),
    ("GET", "/api/v1/memory"), ("GET", "/api/v1/notebook/list"),
    ("GET", "/api/v1/chat/sessions"), ("GET", "/api/v1/solve/sessions"),
    ("GET", "/api/v1/co_writer/documents"), ("GET", "/api/outputs/example.txt"),
    ("GET", "/api/v1/knowledge/configs"), ("GET", "/api/v1/agent-config/agents"),
    ("PUT", "/api/v1/knowledge/default/school"),
    ("POST", "/api/v1/knowledge/create"), ("POST", "/api/v1/knowledge/school/upload"),
    ("POST", "/api/v1/knowledge/school/link-folder"),
    ("DELETE", "/api/v1/knowledge/school"),
    ("PUT", "/api/v1/settings/sidebar/description"),
    ("POST", "/api/v1/plugins/tools/code_execution/execute"),
])
def test_protected_routes_reject_anonymous_and_students(client, method, path):
    assert client.request(method, path).status_code == 401
    assert client.request(method, path, headers={"Authorization": "Bearer student"}).status_code == 403


def test_public_login_status_has_no_anonymous_identity(client):
    response = client.get("/api/v1/auth/status")
    assert response.status_code == 200
    data = response.json()
    assert not data["authenticated"]
    assert data["username"] is None and not data["is_admin"]
    assert client.get("/api/v1/auth/is_first_user").json() == {"is_first_user": False}


def test_admin_can_read_schema_and_docs(client):
    headers = {"Authorization": "Bearer admin"}
    assert client.get("/openapi.json", headers=headers).status_code == 200
    assert client.get("/docs", headers=headers).status_code == 200


def test_invalid_and_pending_tokens_cannot_access_sessions(client):
    assert client.get("/api/v1/sessions", headers={"Authorization": "Bearer invalid"}).status_code == 401
    assert client.get("/api/v1/sessions", headers={"Authorization": "Bearer pending"}).status_code == 403


@pytest.mark.parametrize("path", ["/api/v1/chat", "/api/v1/solve", "/api/v1/book/ws", "/api/v1/question/generate"])
def test_legacy_websockets_reject_student_before_accept(client, path):
    with pytest.raises(WebSocketDisconnect) as rejected:
        with client.websocket_connect(path + "?token=student"):
            pass
    assert rejected.value.code == 4003


def test_admin_cannot_reenable_legacy_execution_websocket(client):
    with pytest.raises(WebSocketDisconnect) as rejected:
        with client.websocket_connect("/api/v1/solve?token=admin"):
            pass
    assert rejected.value.code == 4003


def test_primary_websocket_rejects_anonymous(client):
    with pytest.raises(WebSocketDisconnect) as rejected:
        with client.websocket_connect("/api/v1/ws"):
            pass
    assert rejected.value.code == 4001


def test_websocket_rejects_foreign_browser_origin_even_with_token(client):
    with pytest.raises(WebSocketDisconnect) as rejected:
        with client.websocket_connect("/api/v1/ws?token=student", headers={"Origin": "https://untrusted.example"}):
            pass
    assert rejected.value.code == 4003


@pytest.mark.parametrize("body", [
    {"type": "message", "content": "测试", "capability": "deep_solve"},
    {"type": "message", "content": "测试", "tools": ["code_execution"]},
])
def test_primary_websocket_rejects_hidden_execution(client, body):
    with client.websocket_connect("/api/v1/ws?token=student", headers={"Origin": "http://localhost:3782"}) as ws:
        ws.send_json(body)
        response = ws.receive_json()
    assert response["type"] == "error"
    assert response["metadata"]["status"] == "rejected"
    assert "未开放" in response["content"]


@pytest.mark.parametrize("path,body", [
    ("/api/v1/plugins/tools/code_execution/execute", {}),
    ("/api/v1/plugins/tools/code_execution/execute-stream", {}),
    ("/api/v1/plugins/capabilities/deep_research/execute-stream", {"content": "test"}),
])
def test_hidden_playground_execution_also_rejected_for_admin(client, path, body):
    response = client.post(path, json=body, headers={"Authorization": "Bearer admin"})
    assert response.status_code == 403


def test_student_ui_settings_and_plugins_remain_available(client):
    headers = {"Authorization": "Bearer student"}
    assert client.get("/api/v1/settings/themes", headers=headers).status_code == 200
    # No lifecycle bootstrap: registry can be empty but cannot expose hidden entries.
    response = client.get("/api/v1/plugins/list", headers=headers)
    assert response.status_code == 200
    assert all(item["name"] in {"rag", "web_search"} for item in response.json()["tools"])
    assert all(item["name"] == "chat" for item in response.json()["capabilities"])


def test_unauthenticated_errors_still_get_trusted_cors_headers(client):
    response = client.get("/api/v1/sessions", headers={"Origin": "http://localhost:3782"})
    assert response.status_code == 401
    assert response.headers["access-control-allow-origin"] == "http://localhost:3782"


def test_session_data_is_isolated_between_students(client, tmp_path):
    from deeptutor.services.session.sqlite_store import SQLiteSessionStore

    store = SQLiteSessionStore(db_path=tmp_path / "u_student" / "user" / "chat_history.db")
    session = asyncio.run(store.ensure_session())
    own = client.get(f"/api/v1/sessions/{session['id']}", headers={"Authorization": "Bearer student"})
    other = client.get(f"/api/v1/sessions/{session['id']}", headers={"Authorization": "Bearer other"})
    assert own.status_code == 200
    assert other.status_code == 404
    assert client.get("/api/v1/sessions", headers={"Authorization": "Bearer other"}).json() == {"sessions": []}


def test_foreign_attachment_rejected_before_resolving_storage(client, monkeypatch):
    from deeptutor.api.routers import attachments

    def unexpected_storage_access():
        raise AssertionError("Foreign attachment must be rejected before reading files")

    monkeypatch.setattr(attachments, "get_attachment_store", unexpected_storage_access)
    response = client.get("/api/attachments/foreign-session/file/example.txt", headers={"Authorization": "Bearer student"})
    assert response.status_code == 404


@pytest.mark.parametrize("filename,download", [("policy.pdf", False), ("notes.txt", False), ("sample.xml", True), ("sample.svg", True)])
def test_own_attachment_still_works_and_foreign_user_cannot_read_shared_storage(
    client, tmp_path, monkeypatch, filename, download
):
    from deeptutor.api.routers import attachments
    from deeptutor.services.session.sqlite_store import SQLiteSessionStore
    from deeptutor.services.storage import LocalDiskAttachmentStore

    sessions = SQLiteSessionStore(db_path=tmp_path / "u_student" / "user" / "chat_history.db")
    session = asyncio.run(sessions.ensure_session())
    shared_storage = LocalDiskAttachmentStore(root=tmp_path / "shared-attachments")
    payload = b"%PDF-1.4\n" if filename.endswith(".pdf") else b"<script>alert(1)</script>"
    url = asyncio.run(shared_storage.put(session_id=session["id"], attachment_id="file", filename=filename, data=payload))
    monkeypatch.setattr(attachments, "get_attachment_store", lambda: shared_storage)
    own = client.get(url, headers={"Authorization": "Bearer student"})
    other = client.get(url, headers={"Authorization": "Bearer other"})
    assert own.status_code == 200 and own.content == payload
    assert own.headers["x-content-type-options"] == "nosniff"
    assert own.headers["content-disposition"].startswith("attachment" if download else "inline")
    if download:
        assert own.headers["content-type"] == "application/octet-stream"
        assert "sandbox" in own.headers["content-security-policy"]
    assert other.status_code == 404
