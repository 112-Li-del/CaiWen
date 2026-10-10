"""Dummy checks must consume work but can never authorize a missing account."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from deeptutor.api.routers import auth
from deeptutor.services import auth as service


@pytest.mark.parametrize("users", [{}, {"existing": {"hash": "real-account-hash", "role": "user", "id": "u_test"}}])
@pytest.mark.parametrize("dummy_result", [True, False])
def test_missing_account_always_fails_even_if_dummy_password_matches(monkeypatch, users, dummy_result):
    calls = []
    monkeypatch.setattr(service, "AUTH_ENABLED", True)
    monkeypatch.setattr(service, "_load_users", lambda: users)
    monkeypatch.setattr(service, "verify_password", lambda password, hashed: calls.append(hashed) or dummy_result)
    assert service.authenticate("missing", "any-password") is None
    assert calls == [service._DUMMY_PASSWORD_HASH]


def test_real_account_uses_real_hash_and_disabled_account_cannot_login(monkeypatch):
    record = {"hash": "real-hash", "id": "u_test", "role": "user", "disabled": False}
    calls = []
    monkeypatch.setattr(service, "AUTH_ENABLED", True)
    monkeypatch.setattr(service, "_load_users", lambda: {"existing": record})
    monkeypatch.setattr(service, "verify_password", lambda password, hashed: calls.append(hashed) or True)
    assert service.authenticate("existing", "correct").user_id == "u_test"
    assert calls == ["real-hash"]
    record["disabled"] = True
    assert service.authenticate("existing", "correct") is None


def test_dummy_check_does_not_issue_cookie_or_token(monkeypatch):
    monkeypatch.setattr(auth, "AUTH_ENABLED", True)
    monkeypatch.setattr(auth, "POCKETBASE_ENABLED", False)
    monkeypatch.setattr(service, "AUTH_ENABLED", True)
    monkeypatch.setattr(service, "_load_users", lambda: {})
    monkeypatch.setattr(service, "verify_password", lambda *_: True)
    monkeypatch.setattr(auth, "authenticate", service.authenticate)
    monkeypatch.setattr(auth, "create_token", lambda *_: pytest.fail("dummy check cannot issue token"))
    class Allowed:
        def reserve(self, *_):
            return 0
    monkeypatch.setattr(auth, "_get_login_throttle", lambda: Allowed())
    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")
    with TestClient(app) as client:
        response = client.post("/auth/login", json={"username": "missing", "password": "any-password"})
    assert response.status_code == 401
    assert response.json()["detail"] == "用户名或密码错误。"
    assert "set-cookie" not in response.headers
