"""The reported REST endpoint and its WebSocket counterpart reject remote probes."""

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from deeptutor.api.routers import vision_solver
from deeptutor.tools.vision import image_utils


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(image_utils, "_remote_setting", lambda key, default: default)
    monkeypatch.setattr(
        vision_solver, "get_llm_config",
        lambda: pytest.fail("blocked images must never reach the model"),
    )
    app = FastAPI()
    app.include_router(vision_solver.router, prefix="/api/v1")
    with TestClient(app) as test_client:
        yield test_client


@pytest.mark.parametrize("url", [
    "http://127.0.0.1:8080", "http://127.0.0.1:3782",
    "http://172.16.129.61:8001/openapi.json", "http://[::1]/",
])
def test_reported_rest_probes_have_same_chinese_error(client, url):
    result = client.post("/api/v1/vision/analyze", json={"question": "测试", "image_url": url})
    assert result.status_code == 400
    assert result.json()["detail"] == image_utils.REMOTE_FETCH_FAILED


def test_websocket_probe_uses_same_image_policy(client):
    with client.websocket_connect("/api/v1/vision/solve") as ws:
        ws.send_json({"question": "测试", "image_url": "http://127.0.0.1:3782"})
        assert ws.receive_json()["type"] == "session"
        result = ws.receive_json()
        assert result == {"type": "error", "content": image_utils.REMOTE_FETCH_FAILED}
