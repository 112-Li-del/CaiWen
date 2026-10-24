"""Campus hierarchy and shared defaults, with all files isolated from real accounts."""
import asyncio
import json

import pytest
from fastapi import HTTPException

from deeptutor.multi_user import identity, grants, default_grants
from deeptutor.api.routers import auth
from deeptutor.services.auth import TokenPayload


def test_first_account_owner_and_legacy_backup(mu_isolated_root):
    identity.USERS_FILE.parent.mkdir(parents=True)
    original = {
        "later": {"hash": "h", "role": "admin", "created_at": "2026-09-01", "id": "later"},
        "first": {"hash": "h", "role": "admin", "created_at": "2026-07-01", "id": "first"},
    }
    identity.USERS_FILE.write_text(json.dumps(original), encoding="utf-8")
    users = identity.load_users()
    assert users["first"]["is_super_admin"] is True
    assert users["later"]["is_super_admin"] is False
    assert json.loads(identity.USERS_FILE.with_name("users.pre-hierarchy.json").read_text()) == original
    assert identity.load_users() == users


def test_owner_protected_and_identity_persists(mu_isolated_root):
    owner = identity.save_user("owner", "hash")
    assert owner["is_super_admin"] is True
    identity.save_user("teacher", "hash")
    assert identity.set_member_type("teacher", "teacher")
    assert identity.get_user("teacher")["member_type"] == "teacher"
    with pytest.raises(ValueError):
        identity.set_role("owner", "user")
    with pytest.raises(ValueError):
        identity.delete_user("owner")


def test_backend_hierarchy_blocks_ordinary_admin(mu_isolated_root, monkeypatch):
    monkeypatch.setattr(auth, "AUTH_ENABLED", True)
    owner = identity.save_user("owner", "hash")
    manager = identity.save_user("manager", "hash", role="admin")
    identity.save_user("student", "hash")
    actor = TokenPayload("manager", "admin", manager["id"])
    with pytest.raises(HTTPException) as error:
        asyncio.run(auth.update_user_role("student", auth.SetRoleRequest(role="admin"), actor))
    assert error.value.status_code == 403
    with pytest.raises(HTTPException):
        auth.check_manage_target(actor, "owner")
    highest = TokenPayload("owner", "admin", owner["id"])
    asyncio.run(auth.update_user_role("student", auth.SetRoleRequest(role="admin"), highest))
    assert identity.get_user("student")["role"] == "admin"


def test_existing_member_follows_default_updates_and_revocations(mu_isolated_root, monkeypatch):
    monkeypatch.setattr(default_grants, "_filter_kb_items", lambda items: items)
    monkeypatch.setattr(default_grants, "_filter_model_items", lambda items, service: items)
    path = grants.grant_path("existing")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"knowledge_bases": [{"name": "old-private-assignment"}]}))
    default_grants.save_default_config({"knowledge_bases": [{"name": "学生手册", "access": "read"}]})
    assert grants.load_grant("existing")["knowledge_bases"][0]["name"] == "学生手册"
    default_grants.save_default_config({})
    assert grants.load_grant("existing")["knowledge_bases"] == []
    assert json.loads(path.read_text())["knowledge_bases"][0]["name"] == "old-private-assignment"


def test_individual_grant_write_disabled(monkeypatch):
    from deeptutor.multi_user.router import put_user_grants, GrantPayload
    with pytest.raises(HTTPException) as error:
        asyncio.run(put_user_grants("member", GrantPayload(grant={}), None))
    assert error.value.status_code == 410


def test_admin_assigns_identity_without_promoting_member(mu_isolated_root, monkeypatch):
    monkeypatch.setattr(auth, "AUTH_ENABLED", True)
    identity.save_user("owner", "hash")
    manager = identity.save_user("manager", "hash", role="admin")
    identity.save_user("student", "hash")
    actor = TokenPayload("manager", "admin", manager["id"])
    asyncio.run(auth.update_member_type("student", auth.MemberTypeRequest(member_type="teacher"), actor))
    record = identity.get_user("student")
    assert record["role"] == "user"
    assert record["member_type"] == "teacher"
    with pytest.raises(HTTPException):
        asyncio.run(auth.update_member_type("owner", auth.MemberTypeRequest(member_type="teacher"), actor))


def test_owner_check_uses_persisted_identity_not_a_claim(mu_isolated_root, monkeypatch):
    monkeypatch.setattr(auth, "AUTH_ENABLED", True)
    owner = identity.save_user("owner", "hash")
    assert auth.is_super_admin(TokenPayload("owner", "admin", owner["id"]))
    assert not auth.is_super_admin(TokenPayload("owner", "admin", "forged-id"))


def test_admin_has_no_member_identity(mu_isolated_root, monkeypatch):
    monkeypatch.setattr(auth, "AUTH_ENABLED", True)
    owner = identity.save_user("owner", "hash")
    identity.save_user("member", "hash")
    identity.set_member_type("member", "teacher")
    identity.set_role("member", "admin")
    assert identity.get_user("member")["member_type"] is None
    with pytest.raises(ValueError):
        identity.set_member_type("member", "student")
    actor = TokenPayload("owner", "admin", owner["id"])
    with pytest.raises(HTTPException) as error:
        asyncio.run(auth.update_member_type("member", auth.MemberTypeRequest(member_type="student"), actor))
    assert error.value.status_code == 403
