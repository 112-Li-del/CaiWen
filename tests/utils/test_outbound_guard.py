"""Tests for the outbound URL guard (SSRF policy).

The guard is the fix for the reported SSRF in the vision image-URL path, so
these tests assert the *policy* directly: no request may be issued to a
    non-public address, and policy failures share the same user-facing text.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from contextlib import contextmanager
import http.server
import ipaddress
import threading

import httpx
import pytest

from deeptutor.utils import outbound_guard as guard

# ---------------------------------------------------------------------------
# Address classification
# ---------------------------------------------------------------------------

BLOCKED_LITERALS = [
    "127.0.0.1",
    "127.1.2.3",
    "0.0.0.0",
    "10.0.0.5",
    "172.16.4.4",
    "192.168.1.1",
    "169.254.169.254",  # cloud metadata
    "100.64.0.1",  # CGNAT
    "192.0.2.1",  # TEST-NET-1
    "::1",
    "fe80::1",
    "fc00::1",  # IPv6 ULA
    "::ffff:127.0.0.1",  # IPv4-mapped loopback
    "::ffff:10.0.0.1",
    "224.0.0.1",  # multicast can have is_global=True
    "ff02::1",
    "255.255.255.255",
    "2002:7f00:1::",  # 6to4 embeds loopback
    "2002:a00:1::",  # 6to4 embeds private IPv4
]

ALLOWED_LITERALS = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700::1111"]


@pytest.mark.parametrize("literal", BLOCKED_LITERALS)
def test_blocked_addresses(literal: str) -> None:
    assert guard._is_blocked_ip(ipaddress.ip_address(literal)) is True


@pytest.mark.parametrize("literal", ALLOWED_LITERALS)
def test_public_addresses_allowed(literal: str) -> None:
    assert guard._is_blocked_ip(ipaddress.ip_address(literal)) is False


# ---------------------------------------------------------------------------
# URL policy (all of these refuse before any name resolution or connection)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "gopher://127.0.0.1:6379/_INFO",
        "ftp://example.com/a.png",
        "http://user:pass@example.com/a.png",
        "http://127.0.0.1:8001/openapi.json",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]:8001/openapi.json",
        "http://[invalid/a.png",
        "http://example.com:0/a.png",
        "http://example.com:65536/a.png",
    ],
)
async def test_validate_refuses_bad_urls(url: str) -> None:
    with pytest.raises(guard.OutboundFetchError):
        await guard.validate_outbound_url(url)


@pytest.mark.asyncio
@pytest.mark.parametrize("port", [22, 6379, 8001, 8080, 3306])
async def test_validate_refuses_non_allowlisted_port(port: int) -> None:
    with pytest.raises(guard.OutboundFetchError):
        await guard.validate_outbound_url(f"http://example.com:{port}/a.png")


@pytest.mark.asyncio
async def test_validate_refuses_hostname_resolving_to_private(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_resolve(host: str, port: int):
        return [ipaddress.ip_address("10.1.2.3")]

    monkeypatch.setattr(guard, "_resolve", fake_resolve)
    with pytest.raises(guard.OutboundFetchError):
        await guard.validate_outbound_url("http://intranet.example.com/a.png")


@pytest.mark.asyncio
async def test_validate_refuses_mixed_dns_answers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One private answer among several refuses the whole host (rebinding)."""

    async def fake_resolve(host: str, port: int):
        return [ipaddress.ip_address("93.184.216.34"), ipaddress.ip_address("127.0.0.1")]

    monkeypatch.setattr(guard, "_resolve", fake_resolve)
    with pytest.raises(guard.OutboundFetchError):
        await guard.validate_outbound_url("http://rebind.example.com/a.png")


@pytest.mark.asyncio
async def test_validate_pins_the_validated_address(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_resolve(host: str, port: int):
        return [ipaddress.ip_address("93.184.216.34")]

    monkeypatch.setattr(guard, "_resolve", fake_resolve)
    target = await guard.validate_outbound_url("https://cdn.example.com/a.png")
    assert target.ip == "93.184.216.34"
    assert target.host == "cdn.example.com"
    assert target.port == 443


def test_parse_allowed_ports() -> None:
    assert guard.parse_allowed_ports(None) == guard.DEFAULT_ALLOWED_PORTS
    assert guard.parse_allowed_ports("8080, 8443") == frozenset({8080, 8443})
    assert guard.parse_allowed_ports("*") == frozenset()
    assert guard.parse_allowed_ports("garbage") == guard.DEFAULT_ALLOWED_PORTS


# ---------------------------------------------------------------------------
# Live fetch against a loopback server
# ---------------------------------------------------------------------------

PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 32


class _Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    routes: dict[str, tuple[int, bytes, str, dict[str, str]]] = {}
    seen_host_headers: list[str] = []

    def do_GET(self) -> None:  # noqa: N802 - http.server API
        type(self).seen_host_headers.append(self.headers.get("Host", ""))
        status, body, content_type, extra = self.routes.get(
            self.path, (404, b"nope", "text/plain", {})
        )
        self.send_response(status)
        if content_type:
            self.send_header("Content-Type", content_type)
        for key, value in extra.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: object) -> None:  # keep pytest output clean
        return


@contextmanager
def _loopback_server() -> Iterator[tuple[str, type[_Handler]]]:
    _Handler.routes = {}
    _Handler.seen_host_headers = []
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}", _Handler
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def _resolve_to_loopback(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make any hostname resolve to the loopback test server."""

    async def fake_resolve(host: str, port: int):
        return [ipaddress.ip_address("127.0.0.1")]

    monkeypatch.setattr(guard, "_resolve", fake_resolve)


@pytest.mark.asyncio
async def test_fetch_refuses_loopback_before_connecting() -> None:
    with _loopback_server() as (base, handler):
        handler.routes["/a.png"] = (200, PNG, "image/png", {})
        with pytest.raises(guard.OutboundFetchError) as excinfo:
            await guard.fetch_url_bytes(f"{base}/a.png", allowed_ports=frozenset())
        assert str(excinfo.value) == guard.BLOCKED_MESSAGE
        # Refused by policy: the server never sees a request.
        assert handler.seen_host_headers == []


@pytest.mark.asyncio
async def test_fetch_pins_ip_and_preserves_host_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _resolve_to_loopback(monkeypatch)
    with _loopback_server() as (base, handler):
        handler.routes["/a.png"] = (200, PNG, "image/png", {})
        port = base.rsplit(":", 1)[1]
        body, content_type, _final = await guard.fetch_url_bytes(
            f"http://image.example.com:{port}/a.png",
            allowed_ports=frozenset(),
            allow_private=True,
            allowed_content_types=frozenset({"image/png"}),
        )
        assert body == PNG
        assert content_type == "image/png"
        # Connected to the pinned IP, but the request still carried the real host.
        assert handler.seen_host_headers == [f"image.example.com:{port}"]


@pytest.mark.asyncio
async def test_fetch_revalidates_every_redirect_hop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A redirect pointing at an internal host is refused, not followed."""
    validated: list[str] = []
    real_validate = guard.validate_outbound_url

    with _loopback_server() as (base, handler):
        port = base.rsplit(":", 1)[1]
        handler.routes["/a.png"] = (
            302,
            b"",
            "text/plain",
            {"Location": "http://internal.example.com/a.png"},
        )

        async def fake_validate(url: str, **kwargs):
            validated.append(url)
            if "internal.example.com" in url:
                raise guard.OutboundFetchError("host resolves to non-public address")
            return await real_validate(
                f"http://127.0.0.1:{port}/a.png",
                allowed_ports=frozenset(),
                allow_private=True,
            )

        monkeypatch.setattr(guard, "validate_outbound_url", fake_validate)
        with pytest.raises(guard.OutboundFetchError) as excinfo:
            await guard.fetch_url_bytes(
                "http://public.example.com/a.png", allowed_ports=frozenset()
            )

    assert str(excinfo.value) == guard.BLOCKED_MESSAGE
    assert validated == [
        "http://public.example.com/a.png",
        "http://internal.example.com/a.png",
    ]


@pytest.mark.asyncio
async def test_fetch_enforces_content_type_and_size() -> None:
    with _loopback_server() as (base, handler):
        handler.routes["/a.png"] = (200, b"<html>hi</html>", "text/html", {})
        with pytest.raises(guard.OutboundFetchError):
            await guard.fetch_url_bytes(
                f"{base}/a.png",
                allowed_ports=frozenset(),
                allow_private=True,
                allowed_content_types=frozenset({"image/png"}),
            )

        handler.routes["/big.png"] = (200, b"y" * 4096, "image/png", {})
        with pytest.raises(guard.OutboundFetchError):
            await guard.fetch_url_bytes(
                f"{base}/big.png",
                max_bytes=1024,
                allowed_ports=frozenset(),
                allow_private=True,
                allowed_content_types=frozenset({"image/png"}),
            )


@pytest.mark.asyncio
async def test_all_failure_modes_share_one_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No failure path may be distinguishable from another by its text."""
    messages: set[str] = set()

    async def failing_resolve(host: str, port: int):
        if host == "nx.example.com":
            # Same shape the real resolver produces for NXDOMAIN.
            raise guard.OutboundFetchError("dns failure for host")
        return [ipaddress.ip_address("127.0.0.1")]

    monkeypatch.setattr(guard, "_resolve", failing_resolve)

    with _loopback_server() as (base, handler):
        handler.routes["/a.png"] = (200, b"<html>", "text/html", {})
        cases = [
            # wrong content type
            (f"{base}/a.png", {"allowed_content_types": frozenset({"image/png"})}),
            # 404
            (f"{base}/missing.png", {}),
            # DNS failure
            ("http://nx.example.com/a.png", {}),
            # refused port
            (f"{base}/a.png", {"allowed_ports": frozenset({80})}),
            # refused scheme
            ("file:///etc/passwd", {}),
        ]
        for url, kwargs in cases:
            call_kwargs: dict[str, object] = {
                "allowed_ports": frozenset(),
                "allow_private": True,
            }
            call_kwargs.update(kwargs)
            with pytest.raises(guard.OutboundFetchError) as excinfo:
                await guard.fetch_url_bytes(url, **call_kwargs)  # type: ignore[arg-type]
            messages.add(str(excinfo.value))

    assert messages == {guard.BLOCKED_MESSAGE}


# ---------------------------------------------------------------------------
# Vision entry point
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_vision_remote_url_can_be_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from deeptutor.tools.vision import image_utils

    monkeypatch.setenv("VISION_REMOTE_IMAGE_URL_ENABLED", "false")
    with pytest.raises(image_utils.ImageError) as excinfo:
        await image_utils.fetch_image_from_url("http://example.com/a.png")
    assert str(excinfo.value) == image_utils.REMOTE_FETCH_FAILED


@pytest.mark.asyncio
async def test_vision_refuses_internal_target_with_uniform_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The reported PoC shape: the vision endpoint as an internal port scanner."""
    from deeptutor.tools.vision import image_utils

    monkeypatch.setenv("VISION_REMOTE_IMAGE_URL_ENABLED", "true")
    monkeypatch.delenv("VISION_REMOTE_IMAGE_ALLOW_PRIVATE", raising=False)

    with pytest.raises(image_utils.ImageError) as internal:
        await image_utils.fetch_image_from_url("http://127.0.0.1:8001/openapi.json")

    with pytest.raises(image_utils.ImageError) as other:
        await image_utils.fetch_image_from_url("http://10.0.0.5:8080/a.png")

    # Errors do not distinguish ports by text; this does not test timing.
    assert str(internal.value) == image_utils.REMOTE_FETCH_FAILED
    assert str(other.value) == str(internal.value)


def test_vision_rejects_malformed_url() -> None:
    from deeptutor.tools.vision import image_utils

    assert image_utils.is_valid_image_url("http://example.com/a.png") is True
    assert image_utils.is_valid_image_url("file:///etc/passwd") is False


@pytest.mark.asyncio
@pytest.mark.parametrize("host", ["evil.example", "cdn.example.evil", "other.example"])
async def test_host_allowlist_is_exact_and_checked_before_dns(monkeypatch, host):
    async def forbidden_dns(*args):
        pytest.fail("untrusted hosts must not reach DNS")

    monkeypatch.setattr(guard, "_resolve", forbidden_dns)
    with pytest.raises(guard.OutboundFetchError):
        await guard.validate_outbound_url(
            f"https://{host}/a.png", allowed_hosts=frozenset({"cdn.example"})
        )


@pytest.mark.asyncio
async def test_trusted_host_still_cannot_resolve_to_private_ip(monkeypatch):
    async def private_dns(*args):
        return [ipaddress.ip_address("10.0.0.1")]

    monkeypatch.setattr(guard, "_resolve", private_dns)
    with pytest.raises(guard.OutboundFetchError):
        await guard.validate_outbound_url(
            "https://cdn.example/a.png", allowed_hosts=frozenset({"cdn.example"})
        )


@pytest.mark.asyncio
async def test_redirect_to_unlisted_public_host_never_connects(monkeypatch):
    seen = []

    async def public_dns(*args):
        return [ipaddress.ip_address("8.8.8.8")]

    def respond(request):
        seen.append(request)
        return httpx.Response(302, headers={"Location": "https://untrusted.example/a.png"})

    original_client = httpx.AsyncClient
    monkeypatch.setattr(guard, "_resolve", public_dns)
    monkeypatch.setattr(
        guard.httpx, "AsyncClient",
        lambda **kwargs: original_client(transport=httpx.MockTransport(respond), **kwargs),
    )
    with pytest.raises(guard.OutboundFetchError):
        await guard.fetch_url_bytes(
            "https://cdn.example/a.png", allowed_hosts=frozenset({"cdn.example"})
        )
    assert len(seen) == 1
    assert seen[0].url.host == "8.8.8.8"
    assert seen[0].headers["Host"] == "cdn.example"
    assert seen[0].extensions["sni_hostname"] == "cdn.example"


@pytest.mark.asyncio
async def test_total_timeout_includes_dns(monkeypatch):
    async def slow_dns(*args):
        await asyncio.sleep(10)
        pytest.fail("DNS should have been cancelled")

    monkeypatch.setattr(guard, "_resolve", slow_dns)
    with pytest.raises(guard.OutboundFetchError) as error:
        await guard.fetch_url_bytes("https://cdn.example/a.png", timeout=0.02)
    assert str(error.value) == guard.BLOCKED_MESSAGE


@pytest.mark.asyncio
async def test_default_disabled_remote_download_does_not_affect_upload(monkeypatch):
    from deeptutor.tools.vision import image_utils

    monkeypatch.setattr(image_utils, "_remote_setting", lambda key, default: default)
    assert image_utils.remote_image_urls_enabled() is False
    with pytest.raises(image_utils.ImageError):
        await image_utils.resolve_image_input(image_url="https://cdn.example/a.png")
    uploaded = "data:image/png;base64,aGVsbG8="
    assert await image_utils.resolve_image_input(image_base64=uploaded) == uploaded


@pytest.mark.asyncio
async def test_old_private_override_no_longer_bypasses_vision_policy(monkeypatch):
    from deeptutor.tools.vision import image_utils

    settings = {
        "VISION_REMOTE_IMAGE_URL_ENABLED": "true",
        "VISION_REMOTE_IMAGE_ALLOWED_HOSTS": "internal.example",
        "VISION_REMOTE_IMAGE_ALLOW_PRIVATE": "true",
    }
    monkeypatch.setattr(image_utils, "_remote_setting", lambda key, default: settings.get(key, default))

    async def private_dns(*args):
        return [ipaddress.ip_address("127.0.0.1")]

    async def forbidden_send(*args, **kwargs):
        pytest.fail("private target must never be contacted")

    monkeypatch.setattr(guard, "_resolve", private_dns)
    monkeypatch.setattr(httpx.AsyncClient, "send", forbidden_send)
    with pytest.raises(image_utils.ImageError):
        await image_utils.fetch_image_from_url("http://internal.example/a.png")


@pytest.mark.asyncio
async def test_allowlisted_public_image_still_downloads(monkeypatch):
    from deeptutor.tools.vision import image_utils

    settings = {
        "VISION_REMOTE_IMAGE_URL_ENABLED": "true",
        "VISION_REMOTE_IMAGE_ALLOWED_HOSTS": "cdn.example",
    }
    monkeypatch.setattr(image_utils, "_remote_setting", lambda key, default: settings.get(key, default))

    async def public_dns(*args):
        return [ipaddress.ip_address("8.8.8.8")]

    original_client = httpx.AsyncClient
    monkeypatch.setattr(guard, "_resolve", public_dns)
    monkeypatch.setattr(
        guard.httpx, "AsyncClient",
        lambda **kwargs: original_client(
            transport=httpx.MockTransport(lambda request: httpx.Response(
                200, content=PNG, headers={"Content-Type": "image/png"},
            )), **kwargs,
        ),
    )
    content, mime = await image_utils.fetch_image_from_url("https://cdn.example/a.png")
    assert content == PNG
    assert mime == "image/png"


@pytest.mark.asyncio
@pytest.mark.parametrize("ports", ["*", "8080", "80,8001"])
async def test_vision_cannot_remove_port_restriction(monkeypatch, ports):
    from deeptutor.tools.vision import image_utils

    settings = {
        "VISION_REMOTE_IMAGE_URL_ENABLED": "true",
        "VISION_REMOTE_IMAGE_ALLOWED_HOSTS": "cdn.example",
        "VISION_REMOTE_IMAGE_ALLOWED_PORTS": ports,
    }
    monkeypatch.setattr(image_utils, "_remote_setting", lambda key, default: settings.get(key, default))
    with pytest.raises(image_utils.ImageError):
        await image_utils.fetch_image_from_url("https://cdn.example/a.png")
