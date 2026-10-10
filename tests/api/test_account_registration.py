"""Registration usability and abuse protection with isolated users/counters."""

from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from deeptutor.api.routers import auth
from deeptutor.multi_user import identity
from deeptutor.services import auth as service
from deeptutor.services.login_throttle import AttemptBudget, LoginThrottle


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(identity, "USERS_FILE", tmp_path / "users.json")
    monkeypatch.setattr(identity, "LEGACY_USERS_FILE", tmp_path / "missing-legacy.json")
    monkeypatch.setattr(service, "AUTH_USERNAME", "")
    monkeypatch.setattr(service, "AUTH_PASSWORD_HASH", "")
    monkeypatch.setattr(service, "hash_password", lambda value: f"hashed:{value}")
    identity.save_user("existing", "original-hash")
    monkeypatch.setattr(auth, "AUTH_ENABLED", True)
    monkeypatch.setattr(auth, "POCKETBASE_ENABLED", False)
    guard = LoginThrottle(tmp_path / "register.sqlite3", secret="test", pair=AttemptBudget(2, 60))
    monkeypatch.setattr(auth, "_get_registration_throttle", lambda: guard)
    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")
    with TestClient(app) as test_client:
        yield test_client


def test_duplicate_registration_keeps_clear_message_and_existing_record(client):
    before = identity.load_users()["existing"].copy()
    result = client.post("/auth/register", json={"username": "existing", "password": "different-password"})
    assert result.status_code == 409
    assert "该账号已被注册" in result.json()["detail"]
    assert identity.load_users()["existing"] == before


def test_new_registration_is_pending_and_does_not_become_admin(client):
    result = client.post("/auth/register", json={"username": "new-student", "password": "test-password"})
    assert result.status_code == 201
    assert result.json()["status"] == "pending"
    assert result.json()["role"] == "user"


def test_limit_precedes_account_lookup_and_ignores_forged_ip_headers(client, monkeypatch):
    body = {"username": "existing", "password": "test-password"}
    for index in range(2):
        assert client.post("/auth/register", json=body, headers={"X-Forwarded-For": f"192.0.2.{index}"}).status_code == 409
    monkeypatch.setattr(auth, "list_users", lambda: pytest.fail("must stop before checking accounts"))
    result = client.post("/auth/register", json=body, headers={"X-Forwarded-For": "198.51.100.1"})
    assert result.status_code == 429
    assert int(result.headers["retry-after"]) > 0
    assert "注册尝试次数过多" in result.json()["detail"]


def test_registration_storage_failure_does_not_create_account(client, monkeypatch):
    class Broken:
        def reserve(self, *_):
            raise OSError("private path must not appear")

    monkeypatch.setattr(auth, "_get_registration_throttle", lambda: Broken())
    monkeypatch.setattr(auth, "add_user", lambda *args, **kwargs: pytest.fail("must not create account"))
    result = client.post("/auth/register", json={"username": "new-student", "password": "test-password"})
    assert result.status_code == 503
    assert "private path" not in result.text


def test_ip_budget_limits_registration_with_changing_names(client, monkeypatch, tmp_path):
    guard = LoginThrottle(tmp_path / "ip.sqlite3", secret="test", ip=AttemptBudget(2, 60))
    monkeypatch.setattr(auth, "_get_registration_throttle", lambda: guard)
    for name in ["new-one", "new-two"]:
        assert client.post("/auth/register", json={"username": name, "password": "test-password"}).status_code == 201
    result = client.post("/auth/register", json={"username": "new-three", "password": "test-password"})
    assert result.status_code == 429
    assert "new-three" not in identity.load_users()


def test_create_only_rechecks_under_same_process_write_lock(client):
    def create(index):
        try:
            return identity.save_user("same-new-user", f"hash-{index}", create_only=True)
        except ValueError as exc:
            assert str(exc) == "USER_ALREADY_EXISTS"
            return None

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(create, range(4)))
    winners = [item for item in results if item is not None]
    assert len(winners) == 1
    assert identity.load_users()["same-new-user"] == winners[0]


def test_registration_config_and_storage_are_separate_from_login(monkeypatch, tmp_path):
    from types import SimpleNamespace
    from deeptutor.multi_user import paths
    from deeptutor.services import config
    from deeptutor.services.login_throttle import build_registration_throttle

    monkeypatch.setattr(paths, "SYSTEM_ROOT", tmp_path)
    monkeypatch.setattr(service, "AUTH_SECRET", "test")
    monkeypatch.setattr(config, "get_env_store", lambda: SimpleNamespace(load=lambda: {"AUTH_REGISTER_IP_LIMIT": "80"}))
    for scope in ("PAIR", "ACCOUNT", "IP"):
        for suffix in ("LIMIT", "WINDOW_SECONDS"):
            monkeypatch.delenv(f"AUTH_REGISTER_{scope}_{suffix}", raising=False)
    guard = build_registration_throttle()
    assert guard.path == tmp_path / "auth" / "register_attempts.sqlite3"
    assert guard.budgets == (AttemptBudget(5, 600), AttemptBudget(10, 600), AttemptBudget(80, 600))
    monkeypatch.setenv("AUTH_REGISTER_IP_LIMIT", "0")
    with pytest.raises(ValueError, match="AUTH_REGISTER_IP_LIMIT"):
        build_registration_throttle()


def test_pocketbase_registration_is_also_rate_limited(client, monkeypatch):
    monkeypatch.setattr(auth, "POCKETBASE_ENABLED", True)
    monkeypatch.setattr(auth, "is_first_user", lambda: False)
    body = {"username": "student@example.com", "password": "test-password"}
    assert client.post("/auth/register", json=body).status_code == 403
    assert client.post("/auth/register", json=body).status_code == 403
    assert client.post("/auth/register", json=body).status_code == 429
