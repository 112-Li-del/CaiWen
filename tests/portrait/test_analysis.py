"""Analysis must re-read authorized facts, never accept a browser-supplied profile."""
import asyncio

import pytest
from fastapi import HTTPException

from deeptutor.api.routers.portrait import AnalysisRequest, analyze_portrait
from deeptutor.portrait import service


def test_analysis_uses_server_snapshot_and_configured_llm(monkeypatch):
    import deeptutor.services.llm as llm
    snapshot = dict(dimension='class', semester={'id': 1}, summary={'average': 76},
                    courses=[], metrics={}, tags=[], board={}, calculation='first attempt',
                    demo=True, title='测试班级', revision=4, profile={'dormitory': 'private'})
    seen = {}

    def authorized(*args):
        seen['actor'] = args[1]
        return snapshot

    async def complete(**kwargs):
        seen.update(kwargs)
        return '班级平均成绩为76分。'

    monkeypatch.setattr(service, 'overview', authorized)
    monkeypatch.setattr(llm, 'complete', complete)
    actor = object()
    result = asyncio.run(analyze_portrait(AnalysisRequest(semester_id=1, dimension='class'), actor, object()))
    assert seen['actor'] is actor
    assert '76' in seen['prompt'] and 'private' not in seen['prompt']
    assert result['revision'] == 4
    assert result['response'] == '班级平均成绩为76分。'


def test_unauthorized_analysis_never_calls_model(monkeypatch):
    import deeptutor.services.llm as llm

    def denied(*args):
        raise HTTPException(403, 'forbidden')

    async def forbidden(**kwargs):
        pytest.fail('model called before authorization')

    monkeypatch.setattr(service, 'overview', denied)
    monkeypatch.setattr(llm, 'complete', forbidden)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(analyze_portrait(AnalysisRequest(semester_id=1), None, object()))
    assert exc.value.status_code == 403
