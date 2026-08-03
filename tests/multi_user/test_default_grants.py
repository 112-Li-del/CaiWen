"""Tests for the per-instance default-grants config and auto-grant logic."""

from __future__ import annotations

from deeptutor.multi_user import default_grants as dg


class _FakePathService:
    def __init__(self, settings_dir):
        self._dir = settings_dir

    def get_settings_file(self, name):
        if "." not in name:
            name = f"{name}.json"
        return self._dir / name


class _FakeKBManager:
    def __init__(self, names):
        self._names = list(names)

    def list_knowledge_bases(self):
        return self._names


def _catalog():
    return {
        "services": {
            "llm": {
                "profiles": [
                    {
                        "id": "llm-p-1",
                        "name": "LLM One",
                        "models": [
                            {"id": "m-1", "name": "Model A"},
                            {"id": "m-2", "name": "Model B"},
                        ],
                    }
                ]
            },
            "embedding": {
                "profiles": [
                    {
                        "id": "emb-p-1",
                        "name": "Emb One",
                        "models": [{"id": "e-1", "name": "Emb A"}],
                    }
                ]
            },
            "search": {"profiles": [{"id": "s-p-1", "name": "Search One", "provider": "brave"}]},
        }
    }


def _patch(tmp_path, monkeypatch, *, kb_names=None):
    from deeptutor.multi_user import grants

    monkeypatch.setattr(grants, "GRANTS_DIR", tmp_path / "grants")
    monkeypatch.setattr(dg, "get_admin_path_service", lambda: _FakePathService(tmp_path))
    monkeypatch.setattr(dg, "admin_catalog", _catalog)
    monkeypatch.setattr(
        dg,
        "admin_kb_manager",
        lambda: _FakeKBManager(["学生手册"] if kb_names is None else kb_names),
    )


def test_config_save_load_roundtrip(tmp_path, monkeypatch):
    _patch(tmp_path, monkeypatch)
    config = {
        "version": 1,
        "models": {
            "llm": [{"profile_id": "llm-p-1", "model_ids": ["m-1", "m-2"]}],
            "embedding": [],
            "search": [{"profile_id": "s-p-1"}],
        },
        "knowledge_bases": [
            {
                "resource_id": "admin:kb:学生手册",
                "name": "学生手册",
                "access": "read",
                "source": "admin",
            }
        ],
    }
    saved = dg.save_default_config(config)
    assert saved == dg.load_default_config()
    assert dg.config_path().exists()


def test_normalize_config_rejects_junk(tmp_path, monkeypatch):
    _patch(tmp_path, monkeypatch)
    assert dg.normalize_config(None) == dg.empty_config()
    assert dg.normalize_config("garbage") == dg.empty_config()
    assert dg.normalize_config({"models": {"llm": [{"profile_id": "p"}]}})["models"]["llm"] == [
        {"profile_id": "p"}
    ]


def test_build_default_grant_filters_deleted_resources(tmp_path, monkeypatch):
    _patch(tmp_path, monkeypatch)
    config = {
        "version": 1,
        "models": {
            # m-3 was removed from the profile → only m-1 survives.
            "llm": [{"profile_id": "llm-p-1", "model_ids": ["m-1", "m-3"]}],
            # Profile no longer exists → dropped entirely.
            "embedding": [{"profile_id": "gone-emb", "model_ids": ["e-1"]}],
            "search": [{"profile_id": "s-p-1"}],
        },
        "knowledge_bases": [
            {"resource_id": "admin:kb:学生手册", "name": "学生手册"},
            {"resource_id": "admin:kb:已删除", "name": "已删除"},
        ],
    }
    grant = dg.build_default_grant("u_alice", config)
    assert grant["user_id"] == "u_alice"
    assert grant["models"]["llm"] == [
        {"profile_id": "llm-p-1", "model_ids": ["m-1"], "source": "admin"}
    ]
    assert grant["models"]["embedding"] == []
    assert grant["models"]["search"] == [{"profile_id": "s-p-1", "source": "admin"}]
    assert grant["knowledge_bases"] == [
        {
            "name": "学生手册",
            "resource_id": "admin:kb:学生手册",
            "access": "read",
            "source": "admin",
        }
    ]


def test_apply_default_grant_saves_for_normal_user(tmp_path, monkeypatch):
    _patch(tmp_path, monkeypatch)
    monkeypatch.setattr(
        dg, "get_user_by_id", lambda uid: ("alice", {"role": "user"}) if uid == "u_alice" else None
    )
    dg.save_default_config(
        {
            "models": {
                "llm": [{"profile_id": "llm-p-1", "model_ids": ["m-2"]}],
                "embedding": [],
                "search": [],
            },
            "knowledge_bases": [],
        }
    )

    captured = {}

    def spy_save(user_id, grant):
        captured["user_id"] = user_id
        captured["grant"] = grant
        return grant

    monkeypatch.setattr(dg, "save_grant", spy_save)

    result = dg.apply_default_grant("u_alice")
    assert result is not None
    assert captured["user_id"] == "u_alice"
    assert captured["grant"]["models"]["llm"] == [
        {"profile_id": "llm-p-1", "model_ids": ["m-2"], "source": "admin"}
    ]


def test_apply_default_grant_skips_admin_and_unknown(tmp_path, monkeypatch):
    _patch(tmp_path, monkeypatch)
    calls = []

    def spy_save(user_id, grant):
        calls.append(user_id)
        return grant

    monkeypatch.setattr(dg, "save_grant", spy_save)
    monkeypatch.setattr(
        dg,
        "get_user_by_id",
        lambda uid: ("boss", {"role": "admin"}) if uid == "u_admin" else None,
    )
    dg.save_default_config(
        {
            "models": {
                "llm": [{"profile_id": "llm-p-1", "model_ids": ["m-1"]}],
                "embedding": [],
                "search": [],
            },
            "knowledge_bases": [],
        }
    )

    assert dg.apply_default_grant("u_admin") is None
    assert dg.apply_default_grant("nope") is None
    assert calls == []


def test_apply_default_grant_empty_config_silent_exit(tmp_path, monkeypatch):
    _patch(tmp_path, monkeypatch)
    calls = []

    def spy_save(user_id, grant):
        calls.append(user_id)
        return grant

    monkeypatch.setattr(dg, "save_grant", spy_save)
    monkeypatch.setattr(
        dg,
        "get_user_by_id",
        lambda uid: ("alice", {"role": "user"}) if uid == "u_alice" else None,
    )

    # No config file written → load_default_config() returns an empty config;
    # apply_default_grant must exit silently (None) without writing anything.
    assert dg.apply_default_grant("u_alice") is None
    assert calls == []


def test_apply_default_grant_skips_when_grant_already_exists(tmp_path, monkeypatch):
    _patch(tmp_path, monkeypatch)
    existing_grant = {
        "version": 1,
        "user_id": "u_alice",
        "models": {
            "llm": [{"profile_id": "llm-p-1", "model_ids": ["m-1"], "source": "admin"}],
            "embedding": [],
            "search": [],
        },
        "knowledge_bases": [
            {
                "name": "学生手册",
                "resource_id": "admin:kb:学生手册",
                "access": "read",
                "source": "admin",
            }
        ],
        "skills": [],
        "spaces": [],
    }
    monkeypatch.setattr(dg, "load_grant", lambda uid: existing_grant)
    calls = []

    def spy_save(user_id, grant):
        calls.append(user_id)
        return grant

    monkeypatch.setattr(dg, "save_grant", spy_save)
    monkeypatch.setattr(
        dg,
        "get_user_by_id",
        lambda uid: ("alice", {"role": "user"}) if uid == "u_alice" else None,
    )
    dg.save_default_config(
        {
            "models": {
                "llm": [{"profile_id": "llm-p-1", "model_ids": ["m-2"]}],
                "embedding": [],
                "search": [],
            },
            "knowledge_bases": [],
        }
    )

    # An account that already holds grants must not be re-granted.
    result = dg.apply_default_grant("u_alice")
    assert result == existing_grant
    assert calls == []
