"""Tests for FastAPI CORS settings."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from deeptutor.api import main as api_main


def test_cors_uses_explicit_origins_when_auth_disabled(
    monkeypatch,
) -> None:
    monkeypatch.delenv("AUTH_ENABLED", raising=False)
    monkeypatch.delenv("CORS_ORIGIN", raising=False)
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    monkeypatch.setenv("FRONTEND_PORT", "3782")

    settings = api_main._build_cors_settings()

    assert settings["allow_origin_regex"] is None
    assert "http://localhost:3782" in settings["allow_origins"]
    assert "http://127.0.0.1:3782" in settings["allow_origins"]


def test_cors_requires_explicit_origins_when_auth_enabled(monkeypatch) -> None:
    monkeypatch.setenv("AUTH_ENABLED", "true")
    monkeypatch.setenv("CORS_ORIGIN", "https://app.example.com/")
    monkeypatch.setenv(
        "CORS_ORIGINS",
        "https://foo.example.com, https://bar.example.com\nhttps://foo.example.com",
    )

    settings = api_main._build_cors_settings()

    assert settings["allow_origin_regex"] is None
    assert "https://app.example.com" in settings["allow_origins"]
    assert "https://foo.example.com" in settings["allow_origins"]
    assert "https://bar.example.com" in settings["allow_origins"]
    assert settings["allow_origins"].count("https://foo.example.com") == 1


@pytest.mark.parametrize("value", [
    "*", "https://*.example.com", "null", "file:///tmp/test", "example.com",
    "https://user:password@example.com", "https://example.com/api",
    "https://example.com//", "https://example.com?", "https://example.com#",
    "https://example.com?q=1", "https://example.com#test", "https://example.com:0",
    "https://example.com:65536", "https://example.com:bad", "https://example.com:",
    "https://example.com\\@untrusted.example", "https://exa mple.com", "https://[invalid]",
])
@pytest.mark.parametrize("key", ["CORS_ORIGIN", "CORS_ORIGINS"])
def test_invalid_origin_configuration_fails_closed(monkeypatch, value, key) -> None:
    monkeypatch.delenv("CORS_ORIGIN", raising=False)
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    monkeypatch.setenv(key, value)
    with pytest.raises(ValueError, match="CORS 来源配置无效"):
        api_main._build_cors_settings()


def test_normalize_and_deduplicate_origins(monkeypatch) -> None:
    monkeypatch.setenv("CORS_ORIGIN", " HTTPS://APP.EXAMPLE.COM:443/ ")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.example.com,http://[::1]:3782/,http://example.com:80")
    settings = api_main._build_cors_settings()
    assert settings["allow_origins"].count("https://app.example.com") == 1
    assert "http://[::1]:3782" in settings["allow_origins"]
    assert "http://example.com" in settings["allow_origins"]


@pytest.mark.parametrize("port", ["0", "65536", "bad", "3782/path"])
def test_invalid_frontend_port_fails_closed(monkeypatch, port) -> None:
    monkeypatch.setenv("FRONTEND_PORT", port)
    with pytest.raises(ValueError, match="FRONTEND_PORT 配置无效"):
        api_main._build_cors_settings()


@pytest.mark.parametrize("auth_enabled", ["true", "false"])
@pytest.mark.parametrize("origin,allowed", [
    ("http://172.16.129.61:3782", True),
    ("http://localhost:3782", True),
    ("https://untrusted.example", False),
    ("http://172.16.129.61:18001", False),
    ("http://172.16.129.61:3783", False),
    ("https://172.16.129.61:3782", False),
    ("http://172.16.129.61.untrusted.example:3782", False),
    ("null", False),
])
def test_school_origin_http_responses(monkeypatch, auth_enabled, origin, allowed) -> None:
    monkeypatch.setenv("AUTH_ENABLED", auth_enabled)
    monkeypatch.setenv("FRONTEND_PORT", "3782")
    monkeypatch.setenv("CORS_ORIGIN", "http://172.16.129.61:3782")
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    app = FastAPI()
    app.add_middleware(CORSMiddleware, **api_main._build_cors_settings())

    @app.get("/probe")
    def probe():
        return {"ok": True}

    with TestClient(app) as client:
        response = client.get("/probe", headers={"Origin": origin, "Cookie": "test=not-a-real-token"})
        preflight = client.options("/probe", headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,authorization",
        })
    # CORS governs reading responses; ordinary GET requests can still reach the endpoint.
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == (origin if allowed else None)
    assert preflight.status_code == (200 if allowed else 400)
    assert preflight.headers.get("access-control-allow-origin") == (origin if allowed else None)
    if allowed:
        assert response.headers["access-control-allow-credentials"] == "true"
        assert "Origin" in response.headers["vary"]


def test_frontend_address_can_change_without_code_changes(monkeypatch) -> None:
    monkeypatch.setenv("CORS_ORIGIN", "https://new-campus.example")
    monkeypatch.setenv("CORS_ORIGINS", "")
    settings = api_main._build_cors_settings()
    assert "https://new-campus.example" in settings["allow_origins"]
    assert "http://172.16.129.61:3782" not in settings["allow_origins"]
