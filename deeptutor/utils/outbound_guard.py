"""Guarded outbound HTTP for client-supplied URLs.

Fetching a URL that the *caller* chose turns this process into a proxy: without
a policy check, ``http://127.0.0.1:8001/openapi.json`` or ``http://10.0.0.5/``
lets a remote user reach services that are not exposed to them, and the error
text alone tells them which internal ports are open. Every outbound fetch of a
user-supplied URL must go through this module.

Policy, re-applied to every redirect hop:

* scheme is ``http``/``https``, with no embedded credentials;
* the port is in ``allowed_ports`` (default 80/443);
* when supplied, the host must match an exact trusted-host allowlist;
* *every* address the host resolves to is globally routable — loopback,
  RFC1918, link-local (169.254/16, fe80::/10), CGNAT (100.64/10), multicast,
  reserved, unspecified and IPv6 ULA are refused;
* the connection is pinned to the address that was validated, so a different
  DNS answer between validation and connect (DNS rebinding) cannot redirect the
  request; TLS still verifies against the real hostname via SNI;
* redirects are followed manually, at most ``max_redirects`` times;
* the body is streamed and aborted once it exceeds ``max_bytes``.

Every refusal and every transport/status failure raises the *same*
:class:`OutboundFetchError` with the same message. That uniformity is the point:
distinct error text can become an SSRF oracle. Uniform text does not eliminate
timing differences; blocking the request before connecting is the primary defense. The real reason
is kept on ``OutboundFetchError.detail`` for server-side logging only and must
never be returned to a client.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import ipaddress
import logging
import socket
from urllib.parse import urljoin, urlparse, urlunparse

import httpx

logger = logging.getLogger(__name__)

#: Constant client-facing text for every outbound fetch failure.
BLOCKED_MESSAGE = "无法访问该远程地址，请检查地址或改用文件上传。"

DEFAULT_ALLOWED_PORTS: frozenset[int] = frozenset({80, 443})
DEFAULT_MAX_BYTES = 10 * 1024 * 1024
DEFAULT_TIMEOUT = 30.0
DEFAULT_MAX_REDIRECTS = 3
DEFAULT_USER_AGENT = "CaiWen-OutboundFetch/1.0"

_REDIRECT_STATUS = frozenset({301, 302, 303, 307, 308})


class OutboundFetchError(Exception):
    """Uniform failure for a refused or failed outbound fetch.

    ``str(exc)`` is always :data:`BLOCKED_MESSAGE`; ``detail`` carries the
    server-side reason for logs.
    """

    def __init__(self, detail: str = "") -> None:
        super().__init__(BLOCKED_MESSAGE)
        self.detail = detail


@dataclass(frozen=True)
class ResolvedTarget:
    """A URL that passed the policy, plus the pinned address to connect to."""

    url: str
    scheme: str
    host: str
    port: int
    ip: str


def parse_allowed_ports(
    raw: str | None, default: frozenset[int] = DEFAULT_ALLOWED_PORTS
) -> frozenset[int]:
    """Parse a ``"80,443"`` port list. ``"*"`` means "no port restriction"."""
    if raw is None or not raw.strip():
        return default
    if raw.strip() == "*":
        return frozenset()
    ports: set[int] = set()
    for item in raw.replace(";", ",").split(","):
        item = item.strip()
        if item.isdigit():
            ports.add(int(item))
    return frozenset(ports) if ports else default


def _is_blocked_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        # ::ffff:127.0.0.1 must be judged as 127.0.0.1
        return _is_blocked_ip(mapped)
    # is_global alone is insufficient: multicast can be classified as global.
    # IPv6 transition addresses must also have public embedded IPv4 addresses.
    six_to_four = getattr(ip, "sixtofour", None)
    if six_to_four is not None and _is_blocked_ip(six_to_four):
        return True
    teredo = getattr(ip, "teredo", None)
    if teredo is not None and any(_is_blocked_ip(part) for part in teredo):
        return True
    return not ip.is_global or ip.is_multicast or ip.is_reserved or ip.is_unspecified


async def _resolve(
    host: str, port: int
) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, OSError) as exc:
        raise OutboundFetchError(f"dns failure for host: {exc}") from exc

    addresses: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    for info in infos:
        try:
            addresses.append(ipaddress.ip_address(info[4][0]))
        except (IndexError, ValueError):
            continue
    return addresses


async def validate_outbound_url(
    url: str,
    *,
    allowed_ports: frozenset[int] = DEFAULT_ALLOWED_PORTS,
    allow_private: bool = False,
    allowed_hosts: frozenset[str] | None = None,
) -> ResolvedTarget:
    """Validate ``url`` against the outbound policy and pin a target address.

    Raises:
        OutboundFetchError: on any policy violation or resolution failure.
    """
    try:
        parsed = urlparse(url)
        host = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise OutboundFetchError("malformed URL") from exc
    if parsed.scheme not in ("http", "https"):
        raise OutboundFetchError(f"scheme not allowed: {parsed.scheme!r}")
    if parsed.username or parsed.password:
        raise OutboundFetchError("credentials in URL are not allowed")

    if not host:
        raise OutboundFetchError("URL has no host")

    try:
        host = host.rstrip(".").encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise OutboundFetchError("invalid hostname") from exc
    if allowed_hosts is not None and host not in allowed_hosts:
        raise OutboundFetchError("hostname is not in the trusted allowlist")
    port = port if port is not None else (443 if parsed.scheme == "https" else 80)
    if not 1 <= port <= 65535:
        raise OutboundFetchError("invalid port")

    if allowed_ports and port not in allowed_ports:
        raise OutboundFetchError(f"port not allowed: {port}")

    addresses = await _resolve(host, port)
    if not addresses:
        raise OutboundFetchError("host did not resolve")

    if not allow_private:
        blocked = [str(ip) for ip in addresses if _is_blocked_ip(ip)]
        if blocked:
            raise OutboundFetchError(f"host resolves to non-public address(es): {blocked}")

    return ResolvedTarget(
        url=url,
        scheme=parsed.scheme,
        host=host,
        port=port,
        # Pin the first validated address; httpx would otherwise re-resolve.
        ip=str(addresses[0]),
    )


def _build_pinned_request(
    client: httpx.AsyncClient,
    target: ResolvedTarget,
    *,
    user_agent: str,
) -> httpx.Request:
    """Build a request whose connection target is the validated IP.

    The URL host is replaced with the pinned address while ``Host`` and the TLS
    SNI name keep the original hostname, so virtual hosting and certificate
    verification behave exactly as they would without pinning.
    """
    parsed = urlparse(target.url)
    literal = f"[{target.ip}]" if ":" in target.ip else target.ip
    default_port = 443 if target.scheme == "https" else 80
    netloc = literal if target.port == default_port else f"{literal}:{target.port}"
    pinned = urlunparse(parsed._replace(netloc=netloc))

    return client.build_request(
        "GET",
        pinned,
        headers={
            "Host": parsed.netloc,
            "User-Agent": user_agent,
            "Accept": "*/*",
            "Accept-Encoding": "identity",
        },
        extensions={"sni_hostname": target.host},
    )


async def _fetch_url_bytes(
    url: str,
    *,
    max_bytes: int = DEFAULT_MAX_BYTES,
    timeout: float = DEFAULT_TIMEOUT,
    allowed_ports: frozenset[int] = DEFAULT_ALLOWED_PORTS,
    allowed_content_types: frozenset[str] | None = None,
    allow_private: bool = False,
    max_redirects: int = DEFAULT_MAX_REDIRECTS,
    user_agent: str = DEFAULT_USER_AGENT,
    allowed_hosts: frozenset[str] | None = None,
) -> tuple[bytes, str, str]:
    """Fetch ``url`` under the outbound policy.

    Args:
        url: Caller-supplied URL.
        max_bytes: Hard cap on the response body; the stream is aborted past it.
        timeout: Per-request timeout in seconds.
        allowed_ports: Ports permitted for every hop. Empty set means any port.
        allowed_content_types: Optional lower-case MIME allowlist. Include ``""``
            to accept a missing header.
        allow_private: Disable the private-address check. Intended only for an
            operator who deliberately points at an intranet source; it reopens
            SSRF and logs a warning.
        max_redirects: Redirect hops to follow, each re-validated.
        user_agent: Outbound User-Agent.

    Returns:
        ``(body, content_type, final_url)``.

    Raises:
        OutboundFetchError: for policy refusals, redirect/status errors, body
            over ``max_bytes``, and unexpected content types. The message is
            always :data:`BLOCKED_MESSAGE`.
    """
    if allow_private:
        logger.warning(
            "Outbound private-address check is disabled; user-supplied URLs may "
            "reach the internal network"
        )

    current = url
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(timeout),
        follow_redirects=False,
        # Never let HTTP_PROXY/ALL_PROXY env vars route the request around the
        # address check — the proxy would resolve the hostname itself.
        trust_env=False,
    ) as client:
        for _ in range(max_redirects + 1):
            target = await validate_outbound_url(
                current,
                allowed_ports=allowed_ports,
                allow_private=allow_private,
                allowed_hosts=allowed_hosts,
            )
            request = _build_pinned_request(client, target, user_agent=user_agent)

            try:
                response = await client.send(request, stream=True)
            except httpx.HTTPError as exc:
                raise OutboundFetchError(f"transport failure: {exc!r}") from exc

            try:
                if response.status_code in _REDIRECT_STATUS:
                    location = response.headers.get("location")
                    if not location:
                        raise OutboundFetchError("redirect without Location header")
                    current = urljoin(current, location)
                    continue

                if response.status_code != 200:
                    raise OutboundFetchError(f"unexpected HTTP status: {response.status_code}")

                content_type = (
                    response.headers.get("content-type", "").split(";")[0].strip().lower()
                )
                if allowed_content_types is not None and content_type not in allowed_content_types:
                    raise OutboundFetchError(f"content-type not allowed: {content_type!r}")

                declared = response.headers.get("content-length", "").strip()
                if declared.isdigit() and int(declared) > max_bytes:
                    raise OutboundFetchError(f"declared body too large: {declared} bytes")

                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > max_bytes:
                        raise OutboundFetchError(f"body exceeded {max_bytes} bytes")
                return bytes(body), content_type, target.url
            finally:
                await response.aclose()

        raise OutboundFetchError(f"more than {max_redirects} redirects")


async def fetch_url_bytes(
    url: str,
    *,
    max_bytes: int = DEFAULT_MAX_BYTES,
    timeout: float = DEFAULT_TIMEOUT,
    allowed_ports: frozenset[int] = DEFAULT_ALLOWED_PORTS,
    allowed_content_types: frozenset[str] | None = None,
    allow_private: bool = False,
    max_redirects: int = DEFAULT_MAX_REDIRECTS,
    user_agent: str = DEFAULT_USER_AGENT,
    allowed_hosts: frozenset[str] | None = None,
) -> tuple[bytes, str, str]:
    """Fetch with one total deadline including DNS, redirects and body reads.

    Validate every redirect's host against allowed_hosts when supplied. Empty
    allowlists deny all hosts; None uses only the public-address policy.
    """
    try:
        return await asyncio.wait_for(
            _fetch_url_bytes(
                url,
                max_bytes=max_bytes,
                timeout=timeout,
                allowed_ports=allowed_ports,
                allowed_content_types=allowed_content_types,
                allow_private=allow_private,
                max_redirects=max_redirects,
                user_agent=user_agent,
                allowed_hosts=allowed_hosts,
            ),
            timeout=timeout,
        )
    except OutboundFetchError:
        raise
    except (httpx.HTTPError, httpx.InvalidURL, ValueError, TimeoutError) as exc:
        raise OutboundFetchError(f"fetch failed: {type(exc).__name__}") from exc


__all__ = [
    "BLOCKED_MESSAGE",
    "DEFAULT_ALLOWED_PORTS",
    "DEFAULT_MAX_BYTES",
    "DEFAULT_TIMEOUT",
    "OutboundFetchError",
    "ResolvedTarget",
    "fetch_url_bytes",
    "parse_allowed_ports",
    "validate_outbound_url",
]
