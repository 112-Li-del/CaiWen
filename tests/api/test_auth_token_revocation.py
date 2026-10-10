"""A signed login token cannot preserve removed account privileges."""

import pytest
from deeptutor.services import auth


@pytest.fixture
def account(monkeypatch):
    record = {"id": "u_alice", "role": "admin", "status": "active", "disabled": False}
    users = {"alice": record}
    monkeypatch.setattr(auth, "POCKETBASE_ENABLED", False)
    monkeypatch.setattr(auth, "AUTH_SECRET", "isolated-test-signing-key-not-used-in-production")
    monkeypatch.setattr(auth, "_load_users", lambda: users)
    token = auth.create_token("alice", "admin", "u_alice")
    return users, token


def test_role_change_takes_effect_for_existing_token(account):
    users, token = account
    assert auth.decode_token(token).role == "admin"
    users["alice"]["role"] = "user"
    assert auth.decode_token(token).role == "user"


@pytest.mark.parametrize("change", ["deleted", "disabled", "pending", "recreated"])
def test_old_token_rejected_when_account_no_longer_matches(account, change):
    users, token = account
    if change == "deleted":
        users.clear()
    elif change == "disabled":
        users["alice"]["disabled"] = True
    elif change == "pending":
        users["alice"]["status"] = "pending"
    else:
        users["alice"]["id"] = "u_new_alice"
    assert auth.decode_token(token) is None
