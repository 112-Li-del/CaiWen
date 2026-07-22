from __future__ import annotations

from types import SimpleNamespace

import pytest

from deeptutor.agents.chat.agentic_pipeline import AgenticChatPipeline
from deeptutor.agents.chat.chat_agent import ChatAgent
from deeptutor.core.context import UnifiedContext
from deeptutor.services.prompt import PromptManager


@pytest.fixture(autouse=True)
def _fake_llm_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BRAND_NAME", raising=False)
    PromptManager._cache = {}
    cfg = SimpleNamespace(
        binding="openai",
        model="gpt-test",
        api_key="sk-test",
        base_url="https://example.test/v1",
        api_version=None,
    )
    monkeypatch.setattr(
        "deeptutor.agents.chat.agentic_pipeline.get_llm_config",
        lambda: cfg,
    )
    monkeypatch.setattr("deeptutor.agents.base_agent.get_llm_config", lambda: cfg)


def test_agentic_chat_final_prompt_uses_selected_language(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeRegistry:
        def build_prompt_text(self, *_args, **_kwargs) -> str:
            return "- tool"

    monkeypatch.setattr(
        "deeptutor.agents.chat.agentic_pipeline.get_tool_registry",
        lambda: FakeRegistry(),
    )

    zh_prompt = AgenticChatPipeline(language="zh")._responding_system_prompt([])
    en_prompt = AgenticChatPipeline(language="en")._responding_system_prompt([])

    assert "你是 财问 的最终回答阶段" in zh_prompt
    assert "你的名字是「财问」" in zh_prompt
    assert "DeepTutor" not in zh_prompt
    assert "请严格使用中文" in zh_prompt
    assert "You are 财问's final response stage" in en_prompt
    assert 'Your name is "财问"' in en_prompt
    assert "DeepTutor" not in en_prompt
    assert "Write ALL reader-facing text" in en_prompt


def test_legacy_chat_agent_system_prompt_uses_selected_language() -> None:
    zh_messages = ChatAgent(language="zh", config={}).build_messages(
        message="解释梯度下降",
        history=[],
    )
    en_messages = ChatAgent(language="en", config={}).build_messages(
        message="Explain gradient descent",
        history=[],
    )

    assert "你是 财问" in zh_messages[0]["content"]
    assert "香港大学" not in zh_messages[0]["content"]
    assert "DeepTutor" not in zh_messages[0]["content"]
    assert "请严格使用中文" in zh_messages[0]["content"]
    assert "You are 财问" in en_messages[0]["content"]
    assert "HKU" not in en_messages[0]["content"]
    assert "DeepTutor" not in en_messages[0]["content"]
    assert "Write ALL reader-facing text" in en_messages[0]["content"]


def test_chat_prompts_support_brand_override(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeRegistry:
        def build_prompt_text(self, *_args, **_kwargs) -> str:
            return "- tool"

    monkeypatch.setenv("BRAND_NAME", "CampusAI")
    monkeypatch.setattr(
        "deeptutor.agents.chat.agentic_pipeline.get_tool_registry",
        lambda: FakeRegistry(),
    )
    PromptManager._cache = {}

    agentic_prompt = AgenticChatPipeline(language="en")._responding_system_prompt([])
    legacy_prompt = ChatAgent(language="en", config={}).build_messages(
        message="Who are you?",
        history=[],
    )[0]["content"]

    assert "CampusAI" in agentic_prompt
    assert "CampusAI" in legacy_prompt
    assert "财问" not in agentic_prompt
    assert "财问" not in legacy_prompt


def test_agentic_chat_normalizes_legacy_brand_only_in_inherited_model_output() -> None:
    pipeline = AgenticChatPipeline.__new__(AgenticChatPipeline)
    pipeline._brand = "财问"

    context = UnifiedContext(
        session_id="legacy-brand-session",
        user_message="你好",
        conversation_history=[
            {"role": "system", "content": "此前助手自称 DeepTutor。"},
            {"role": "user", "content": "请比较 DeepTutor 与财问。"},
            {"role": "assistant", "content": "我是DeepTutor，可以提供学习辅导。"},
        ],
        language="zh",
    )

    messages = pipeline._build_messages(
        context=context,
        system_prompt="当前系统提示。",
        user_content="请回答用户的新消息。",
    )

    assert messages[0] == {"role": "system", "content": "当前系统提示。"}
    assert all("此前助手自称 DeepTutor。" not in str(message) for message in messages)
    assert messages[1] == {"role": "user", "content": "请比较 DeepTutor 与财问。"}
    assert messages[2] == {
        "role": "assistant",
        "content": "我是财问，可以提供学习辅导。",
    }
    assert messages[3] == {"role": "user", "content": "请回答用户的新消息。"}


def test_legacy_chat_normalizes_legacy_brand_only_in_assistant_history() -> None:
    messages = ChatAgent(language="zh", config={}).build_messages(
        message="你好",
        history=[
            {"role": "user", "content": "请比较 DeepTutor 与财问。"},
            {"role": "assistant", "content": "我是 DeepTutor。"},
        ],
    )

    assert messages[1] == {"role": "user", "content": "请比较 DeepTutor 与财问。"}
    assert messages[2] == {"role": "assistant", "content": "我是 财问。"}
