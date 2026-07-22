from __future__ import annotations

from types import SimpleNamespace

import pytest

from deeptutor.services import branding


def test_brand_defaults_to_caiwen(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BRAND_NAME", raising=False)
    monkeypatch.setattr(
        branding,
        "get_env_store",
        lambda: SimpleNamespace(get=lambda *_args: ""),
    )

    assert branding.get_brand_name() == "财问"


def test_brand_environment_override_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BRAND_NAME", "CampusAI")
    monkeypatch.setattr(
        branding,
        "get_env_store",
        lambda: SimpleNamespace(get=lambda *_args: "财问"),
    )

    assert branding.get_brand_name() == "CampusAI"


def test_brand_substitution_only_replaces_explicit_placeholder() -> None:
    data = {
        "identity": "You are {{BRAND_NAME}}.",
        "technical_origin": "DeepTutor compatibility layer",
        "items": ["{{BRAND_NAME}} assistant"],
    }

    result = branding.substitute_brand_placeholders(data, "财问")

    assert result == {
        "identity": "You are 财问.",
        "technical_origin": "DeepTutor compatibility layer",
        "items": ["财问 assistant"],
    }


def test_inherited_brand_normalization_avoids_technical_identifiers() -> None:
    content = "我是DeepTutor。DeepTutor 可以帮你；DeepTutorCore 保持不变。"

    result = branding.normalize_inherited_brand(content, "财问")

    assert result == "我是财问。财问 可以帮你；DeepTutorCore 保持不变。"
