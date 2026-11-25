"""Exercise the campus HTTP and WebSocket entry points with persisted accounts."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from deeptutor.api import main
from deeptutor.api.routers import auth
from deeptutor.multi_user import identity, paths
from deeptutor.services import auth as auth_service
from deeptutor.services.session.sqlite_store import SQLiteSessionStore


@pytest.fixture
def campus(monkeypatch, tmp_path):
    auth_dir = tmp_path / "_system" / "auth"
    monkeypatch.setattr(paths, "SYSTEM_ROOT", auth_dir.parent)
    monkeypatch.setattr(paths, "MULTI_USER_ROOT", tmp_path)
    monkeypatch.setattr(identity, "AUTH_DIR", auth_dir)
    monkeypatch.setattr(identity, "USERS_FILE", auth_dir / "users.json")
    monkeypatch.setattr(identity, "LEGACY_USERS_FILE", tmp_path / "absent.json")
    monkeypatch.setattr(auth_service, "AUTH_USERNAME", "")
    monkeypatch.setattr(auth_service, "AUTH_PASSWORD_HASH", "")
    monkeypatch.setattr(auth, "AUTH_ENABLED", True)
    monkeypatch.setattr(auth_service, "AUTH_ENABLED", True)
    monkeypatch.setattr(auth, "POCKETBASE_ENABLED", False)
    monkeypatch.setattr(auth_service, "POCKETBASE_ENABLED", False)
    monkeypatch.setattr(auth, "_SECURE", False)
    monkeypatch.setattr(auth, "_get_login_throttle", lambda: SimpleNamespace(reserve=lambda *_: 0))
    password_hash = auth_service.hash_password("test-only-password")
    identity.save_user("owner", password_hash, role="admin")
    account = identity.save_user("teacher", password_hash, role="admin")
    user_id = account["id"]
    store = SQLiteSessionStore(tmp_path / user_id / "user" / "chat_history.db")

    async def seed_history():
        await store.create_session(title="Existing chat", session_id="old-chat")
        turn = await store.create_turn("old-chat")
        await store.append_turn_event(turn["id"], {"type": "content", "content": "First"})
        await store.append_turn_event(turn["id"], {"type": "content", "content": "Second"})
        return turn["id"]

    turn_id = asyncio.run(seed_history())
    client = TestClient(main.app)
    try:
        yield client, user_id, turn_id
    finally:
        client.close()


def login(client):
    return client.post("/api/v1/auth/login", json={
        "username": "teacher", "password": "test-only-password",
    })


def test_existing_account_history_and_live_role_change(campus):
    client, user_id, _ = campus
    assert login(client).json()["user_id"] == user_id
    assert client.get("/api/v1/sessions/old-chat").json()["title"] == "Existing chat"
    assert client.get("/api/v1/auth/users").status_code == 200
    assert client.get("/api/v1/tutorbot/bots").status_code == 404
    assert identity.set_role("teacher", "user")
    assert client.get("/api/v1/auth/users").status_code == 403
    assert client.get("/api/v1/sessions/old-chat").status_code == 200


def test_chat_reconnect_and_logout_revoke_session(campus):
    client, _, turn_id = campus
    assert login(client).status_code == 200
    cookie = f"dt_token={client.cookies['dt_token']}"
    headers = {"Cookie": cookie, "Origin": "http://localhost:3782"}
    with client.websocket_connect("/api/v1/ws", headers=headers) as ws:
        ws.send_json({"type": "subscribe_turn", "turn_id": turn_id})
        first = ws.receive_json()
        assert first["content"] == "First"

    with client.websocket_connect("/api/v1/ws", headers=headers) as ws:
        ws.send_json({"type": "resume_from", "turn_id": turn_id, "seq": first["seq"]})
        assert ws.receive_json()["content"] == "Second"
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}
        assert client.post("/api/v1/auth/logout", headers={"Origin": "https://foreign.example"}).status_code == 403
        assert client.post("/api/v1/auth/logout").status_code == 200
        ws.send_json({"type": "ping"})
        with pytest.raises(WebSocketDisconnect) as disconnected:
            ws.receive_json()
        assert disconnected.value.code == 4001

    assert client.get("/api/v1/sessions", headers=headers).status_code == 401
    with pytest.raises(WebSocketDisconnect) as disconnected:
        with client.websocket_connect("/api/v1/ws", headers=headers):
            pass
    assert disconnected.value.code == 4001


def test_prior_jwt_login_is_not_accepted(campus):
    from jose import jwt

    client, user_id, _ = campus
    old_token = jwt.encode(
        {"sub": "teacher", "uid": user_id, "role": "admin"},
        "previous-test-signing-key", algorithm="HS256",
    )
    assert client.get("/api/v1/auth/users", headers={"Cookie": f"dt_token={old_token}"}).status_code == 401

