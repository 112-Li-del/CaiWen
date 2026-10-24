"""Regression tests for per-user knowledge-base visibility and grants."""

from __future__ import annotations

import json

import pytest
from fastapi import HTTPException

from deeptutor.multi_user.grants import save_grant
from deeptutor.multi_user.knowledge_access import (
    _manager_for,
    list_visible_knowledge_bases,
    resolve_kb,
)


def _seed_kbs(root, *names: str) -> None:
    kb_root = root / "knowledge_bases"
    kb_root.mkdir(parents=True, exist_ok=True)
    (kb_root / "kb_config.json").write_text(
        json.dumps(
            {"knowledge_bases": {name: {"path": name, "status": "ready"} for name in names}}
        ),
        encoding="utf-8",
    )


def test_non_admin_only_sees_own_and_granted_admin_kbs(mu_isolated_root, as_user):
    from deeptutor.multi_user import identity

    # Grant assignment requires a real user record, not only a request context.
    identity.USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    identity.USERS_FILE.write_text(
        json.dumps({"alice": {"id": "u_alice", "hash": "test-hash", "role": "user"}}),
        encoding="utf-8",
    )
    _seed_kbs(mu_isolated_root / "data", "allowed", "forbidden")
    _seed_kbs(mu_isolated_root / "multi-user" / "u_alice", "personal")
    from deeptutor.multi_user.default_grants import save_default_config
    save_default_config(
        {"knowledge_bases": [{"resource_id": "admin:kb:allowed", "name": "allowed"}]},
    )
    _manager_for.cache_clear()

    with as_user("u_alice"):
        visible = list_visible_knowledge_bases()
        assert {(item["id"], item["name"]) for item in visible} == {
            ("user:kb:personal", "personal"),
            ("admin:kb:allowed", "allowed"),
        }
        assert resolve_kb("personal").source == "user"
        assert resolve_kb("allowed").assigned is True
        with pytest.raises(HTTPException) as exc:
            resolve_kb("forbidden")
        assert exc.value.status_code in {403, 404}


def test_non_admin_with_no_grants_cannot_see_admin_kbs(mu_isolated_root, as_user):
    _seed_kbs(mu_isolated_root / "data", "admin-only")
    _manager_for.cache_clear()

    with as_user("u_bob"):
        assert list_visible_knowledge_bases() == []
        with pytest.raises(HTTPException) as exc:
            resolve_kb("admin-only")
        assert exc.value.status_code in {403, 404}
