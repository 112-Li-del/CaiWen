from __future__ import annotations

import pytest

from deeptutor.capabilities._answer_now import load_answer_now_prompts
from deeptutor.services.prompt import PromptManager


@pytest.mark.parametrize("module", ["solve", "question", "research", "visualize"])
def test_answer_now_prompts_use_caiwen_brand(
    module: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("BRAND_NAME", raising=False)
    PromptManager._cache = {}

    prompts = load_answer_now_prompts(module, "zh")

    assert "财问" in prompts["system"]
    assert "DeepTutor" not in prompts["system"]
