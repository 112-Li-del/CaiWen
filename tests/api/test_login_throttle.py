"""Login protection tests with temporary stores, no real accounts or network."""

from concurrent.futures import ThreadPoolExecutor
import sqlite3

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from deeptutor.api.routers import auth
from deeptutor.services.auth import TokenPayload
from deeptutor.services.login_throttle import AttemptBudget, LoginThrottle


def limiter(tmp_path, **kwargs):
    return LoginThrottle(tmp_path / "attempts.sqlite3", secret="test-secret", **kwargs)


def test_pair_cooldown_does_not_extend_on_rejection(tmp_path):
    now = [100.0]
    guard = limiter(tmp_path, clock=lambda: now[0])
    for _ in range(5):
        assert guard.reserve("alice", "192.0.2.1") == 0
    assert guard.reserve("alice", "192.0.2.1") == 60
    now[0] += 30
    assert guard.reserve("alice", "192.0.2.1") == 30
    # Another student sharing this campus IP is not blocked by Alice's pair.
    assert guard.reserve("bob", "192.0.2.1") == 0
    now[0] += 30
    assert guard.reserve("alice", "192.0.2.1") == 0


def test_account_budget_survives_changing_ips_and_new_instance(tmp_path):
    guard = limiter(tmp_path, account=AttemptBudget(3, 300), clock=lambda: 100)
    for index in range(3):
        assert guard.reserve("alice", f"192.0.2.{index}") == 0
    restarted = limiter(tmp_path, account=AttemptBudget(3, 300), clock=lambda: 100)
    assert restarted.reserve("alice", "198.51.100.1") == 300
    assert restarted.reserve("bob", "198.51.100.1") == 0


def test_ip_budget_blocks_password_spraying(tmp_path):
    guard = limiter(tmp_path, ip=AttemptBudget(3, 60), clock=lambda: 100)
    for index in range(3):
        assert guard.reserve(f"user-{index}", "192.0.2.1") == 0
    assert guard.reserve("another-user", "192.0.2.1") == 60


def test_atomic_reservations_across_independent_connections(tmp_path):
    # Separate limiter instances model separate workers sharing a database.
    def reserve(_):
        return limiter(tmp_path, clock=lambda: 100).reserve("alice", "192.0.2.1")

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(reserve, range(25)))
    assert results.count(0) == 5
    assert results.count(60) == 20


def test_expired_keys_are_removed_and_identifiers_are_not_stored(tmp_path):
    now = [100.0]
    guard = limiter(tmp_path, clock=lambda: now[0])
    guard.reserve("private-user", "192.0.2.1")
    with sqlite3.connect(guard.path) as conn:
        keys = [row[0] for row in conn.execute("SELECT key FROM attempts")]
    assert len(keys) == 3
    assert all(len(key) == 64 and "private-user" not in key for key in keys)
    now[0] += 301
    guard.reserve("bob", "198.51.100.1")
    with sqlite3.connect(guard.path) as conn:
        assert conn.execute("SELECT count(*) FROM attempts").fetchone()[0] == 3


@pytest.fixture
def client(tmp_path, monkeypatch):
    guard = limiter(tmp_path)
    monkeypatch.setattr(auth, "AUTH_ENABLED", True)
    monkeypatch.setattr(auth, "POCKETBASE_ENABLED", False)
    monkeypatch.setattr(auth, "_get_login_throttle", lambda: guard)
    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")
    with TestClient(app) as test_client:
        yield test_client


def test_http_limit_precedes_password_check_and_ignores_forged_forwarding(client, monkeypatch):
    calls = []
    monkeypatch.setattr(auth, "authenticate", lambda *args: calls.append(args))
    for index in range(5):
        result = client.post(
            "/auth/login", json={"username": "alice", "password": "bad"},
            headers={"X-Forwarded-For": f"192.0.2.{index}"},
        )
        assert result.status_code == 401
    blocked = client.post("/auth/login", json={"username": "alice", "password": "bad"})
    assert blocked.status_code == 429
    assert 1 <= int(blocked.headers["Retry-After"]) <= 60
    assert len(calls) == 5
    assert "dt_token" not in blocked.cookies


def test_successful_login_keeps_cookie_and_consumes_budget(client, monkeypatch):
    monkeypatch.setattr(auth, "authenticate", lambda *args: TokenPayload("alice", "user", "u_1"))
    monkeypatch.setattr(auth, "create_token", lambda *args: "test-jwt")
    for _ in range(5):
        response = client.post("/auth/login", json={"username": "alice", "password": "correct"})
        assert response.status_code == 200
        assert response.cookies["dt_token"] == "test-jwt"
        assert "HttpOnly" in response.headers["set-cookie"]
    assert client.post("/auth/login", json={"username": "alice", "password": "correct"}).status_code == 429


def test_pocketbase_login_is_also_protected(client, monkeypatch):
    monkeypatch.setattr(auth, "POCKETBASE_ENABLED", True)
    monkeypatch.setattr(auth, "authenticate_pb", lambda *args: None)
    for _ in range(5):
        assert client.post("/auth/login", json={"username": "Alice@example.org", "password": "bad"}).status_code == 401
    assert client.post("/auth/login", json={"username": "ALICE@example.org", "password": "bad"}).status_code == 429


def test_throttle_storage_failure_fails_closed(client, monkeypatch):
    class BrokenStore:
        def reserve(self, *args):
            raise sqlite3.OperationalError("private database details")

    monkeypatch.setattr(auth, "_get_login_throttle", lambda: BrokenStore())
    monkeypatch.setattr(auth, "authenticate", lambda *args: pytest.fail("must not check password"))
    response = client.post("/auth/login", json={"username": "alice", "password": "bad"})
    assert response.status_code == 503
    assert "private database details" not in response.text


def test_disabled_auth_does_not_access_throttle(client, monkeypatch):
    monkeypatch.setattr(auth, "AUTH_ENABLED", False)
    monkeypatch.setattr(auth, "_get_login_throttle", lambda: pytest.fail("disabled auth"))
    assert client.post("/auth/login", json={"username": "alice", "password": "bad"}).status_code == 200


def test_configuration_loads_env_file_and_environment_override(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from deeptutor.multi_user import paths
    from deeptutor.services import config
    from deeptutor.services.login_throttle import build_login_throttle

    monkeypatch.setattr(paths, "SYSTEM_ROOT", tmp_path)
    monkeypatch.setattr("deeptutor.services.auth.AUTH_SECRET", "test-secret")
    monkeypatch.setattr(config, "get_env_store", lambda: SimpleNamespace(load=lambda: {
        "AUTH_LOGIN_PAIR_LIMIT": "7", "AUTH_LOGIN_ACCOUNT_LIMIT": "30",
    }))
    for scope in ("PAIR", "ACCOUNT", "IP"):
        for suffix in ("LIMIT", "WINDOW_SECONDS"):
            monkeypatch.delenv(f"AUTH_LOGIN_{scope}_{suffix}", raising=False)
    monkeypatch.setenv("AUTH_LOGIN_PAIR_LIMIT", "9")
    guard = build_login_throttle()
    assert guard.budgets == (AttemptBudget(9, 60), AttemptBudget(30, 300), AttemptBudget(300, 60))
    monkeypatch.setenv("AUTH_LOGIN_PAIR_LIMIT", "0")
    with pytest.raises(ValueError, match="AUTH_LOGIN_PAIR_LIMIT"):
        build_login_throttle()
