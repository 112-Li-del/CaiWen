"""Campus execution restrictions cover defaults and regeneration, not local CLI."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from deeptutor.runtime.campus_policy import campus_request
from deeptutor.services.session.turn_runtime import TurnRuntimeManager


@pytest.mark.parametrize("payload", [
    {"capability": "deep_research"}, {"capability": "math_animator"},
    {"capability": "chat", "tools": ["code_execution"]},
    {"capability": "chat", "tools": ["rag", "paper_search"]},
])
def test_reject_before_creating_session_or_spending_model_budget(payload):
    store = SimpleNamespace(ensure_session=AsyncMock())
    flag = campus_request.set(True)
    try:
        with pytest.raises(RuntimeError, match="未开放"):
            asyncio.run(TurnRuntimeManager(store=store).start_turn(payload))
        store.ensure_session.assert_not_called()
    finally:
        campus_request.reset(flag)


@pytest.mark.parametrize("overrides,preferences", [
    ({"tools": ["code_execution"]}, {}),
    ({}, {"capability": "deep_solve"}),
])
def test_rejected_regeneration_keeps_previous_answer(overrides, preferences):
    store = SimpleNamespace(
        get_session=AsyncMock(return_value={"preferences": preferences}),
        get_active_turn=AsyncMock(return_value=None),
        get_last_message=AsyncMock(return_value={"id": 1, "role": "user"}),
        delete_message=AsyncMock(),
    )
    flag = campus_request.set(True)
    try:
        with pytest.raises(RuntimeError, match="未开放"):
            asyncio.run(TurnRuntimeManager(store=store).regenerate_last_turn("session", overrides))
        store.delete_message.assert_not_called()
    finally:
        campus_request.reset(flag)


def test_default_chat_tools_are_restricted_in_campus_requests(monkeypatch):
    from deeptutor.core.context import UnifiedContext
    from deeptutor.runtime.orchestrator import ChatOrchestrator

    seen = []

    async def run(context, stream):
        seen.extend(context.enabled_tools)
        await stream.content("校园问答仍然可用", source="chat")

    orch = ChatOrchestrator()
    orch._cap_registry = SimpleNamespace(get=lambda name: SimpleNamespace(run=run))
    monkeypatch.setattr(orch, "_publish_completion", AsyncMock())

    async def collect():
        return [event async for event in orch.handle(UnifiedContext(user_message="学校政策"))]

    flag = campus_request.set(True)
    try:
        events = asyncio.run(collect())
    finally:
        campus_request.reset(flag)
    assert set(seen) == {"rag", "web_search"}
    assert any(event.content == "校园问答仍然可用" for event in events)
