"""Image processing utilities - URL download and format conversion."""

import base64
import logging
import os
from urllib.parse import urlparse

from deeptutor.utils.outbound_guard import (
    DEFAULT_ALLOWED_PORTS,
    OutboundFetchError,
    fetch_url_bytes,
    parse_allowed_ports,
)

logger = logging.getLogger(__name__)

# Supported image MIME types
SUPPORTED_IMAGE_TYPES = {
    "image/jpeg": "jpeg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
}

# Maximum image size (10MB)
MAX_IMAGE_SIZE = 10 * 1024 * 1024

# Request timeout (seconds)
REQUEST_TIMEOUT = 30

# Every remote-fetch failure uses one Chinese string. Uniform text reduces
# information leakage, but does not eliminate timing differences. Blocking
# untrusted/private targets before connecting is the actual SSRF protection.
REMOTE_FETCH_FAILED = "无法加载该远程图片，请检查地址或改用图片上传。"

# Remote image URLs are fetched by the server, so they are an SSRF surface even
# though the vision UI only ever uploads files. The transport is policy-checked
# in deeptutor.utils.outbound_guard; set this to false to remove the capability
# entirely. It is off by default; enabling it also requires trusted hosts.
_REMOTE_URL_ENV = "VISION_REMOTE_IMAGE_URL_ENABLED"
_PORTS_ENV = "VISION_REMOTE_IMAGE_ALLOWED_PORTS"
_HOSTS_ENV = "VISION_REMOTE_IMAGE_ALLOWED_HOSTS"


def _remote_setting(key: str, default: str) -> str:
    from deeptutor.services.config import get_env_store

    value = os.getenv(key)
    if value is not None:
        return value
    return str(get_env_store().load().get(key, default))


def remote_image_urls_enabled() -> bool:
    """Whether fetching an image from a remote URL is enabled at all."""
    return _remote_setting(_REMOTE_URL_ENV, "false").strip().lower() in {"1", "true", "yes", "on"}


def _allowed_ports() -> frozenset[int]:
    ports = parse_allowed_ports(_remote_setting(_PORTS_ENV, "80,443"), DEFAULT_ALLOWED_PORTS)
    if not ports or not ports.issubset(DEFAULT_ALLOWED_PORTS):
        raise ImageError(REMOTE_FETCH_FAILED)
    return ports


def _allowed_hosts() -> frozenset[str]:
    """Exact trusted hosts only; no wildcard/suffix matching or private bypass."""
    values = _remote_setting(_HOSTS_ENV, "")
    try:
        return frozenset(
            item.strip().rstrip(".").encode("idna").decode("ascii").lower()
            for item in values.split(",") if item.strip()
        )
    except UnicodeError as exc:
        raise ImageError(REMOTE_FETCH_FAILED) from exc


class ImageError(Exception):
    """Image processing error."""

    pass


def is_valid_image_url(url: str) -> bool:
    """Check if a URL is valid for images.

    Args:
        url: URL to check

    Returns:
        True if valid URL format
    """
    try:
        parsed = urlparse(url)
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)
    except Exception:
        return False


def is_base64_image(data: str) -> bool:
    """Check if data is base64 encoded image.

    Args:
        data: Data to check

    Returns:
        True if data:image/...;base64,... format
    """
    return data.startswith("data:image/") and ";base64," in data


async def fetch_image_from_url(url: str) -> tuple[bytes, str]:
    """Download an image from a caller-supplied URL.

    The request goes through :func:`deeptutor.utils.outbound_guard.fetch_url_bytes`,
    which refuses non-public targets (loopback, RFC1918, link-local, CGNAT, IPv6
    ULA, ...), pins the validated address to defeat DNS rebinding, restricts the
    port, re-validates every redirect hop, and caps the body size.

    Args:
        url: Image URL

    Returns:
        (image bytes, MIME type)

    Raises:
        ImageError: If the URL is refused, the download fails, or the format is
            unsupported. The message is always :data:`REMOTE_FETCH_FAILED` so the
            response does not disclose the target's error details.
    """
    if not is_valid_image_url(url):
        logger.warning("Rejected malformed remote image URL")
        raise ImageError(REMOTE_FETCH_FAILED)

    if not remote_image_urls_enabled():
        logger.warning("Remote image URLs are disabled by %s", _REMOTE_URL_ENV)
        raise ImageError(REMOTE_FETCH_FAILED)

    logger.info("Fetching an allowlisted remote image")

    try:
        content, content_type, final_url = await fetch_url_bytes(
            url,
            max_bytes=MAX_IMAGE_SIZE,
            timeout=REQUEST_TIMEOUT,
            allowed_ports=_allowed_ports(),
            # Accept a missing/opaque type here so the extension fallback below
            # still works; everything else is refused before the body is read.
            allowed_content_types=frozenset(SUPPORTED_IMAGE_TYPES)
            | {"application/octet-stream", ""},
            allow_private=False,
            allowed_hosts=_allowed_hosts(),
        )
    except OutboundFetchError as exc:
        # Do not log the caller's URL or transport details (may contain secrets).
        logger.warning("Remote image fetch refused or failed")
        raise ImageError(REMOTE_FETCH_FAILED) from exc
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Remote image fetch raised unexpectedly: %s", type(exc).__name__)
        raise ImageError(REMOTE_FETCH_FAILED) from exc

    if not content_type or content_type == "application/octet-stream":
        content_type = guess_image_type_from_url(final_url)

    if content_type not in SUPPORTED_IMAGE_TYPES:
        logger.warning("Remote image had unsupported content type: %s", content_type)
        raise ImageError(REMOTE_FETCH_FAILED)

    logger.info("Image fetched successfully: %d bytes, type: %s", len(content), content_type)
    return content, content_type


def guess_image_type_from_url(url: str) -> str:
    """Infer image type from URL.

    Args:
        url: Image URL

    Returns:
        Inferred MIME type
    """
    url_lower = url.lower()

    if ".png" in url_lower:
        return "image/png"
    elif ".jpg" in url_lower or ".jpeg" in url_lower:
        return "image/jpeg"
    elif ".gif" in url_lower:
        return "image/gif"
    elif ".webp" in url_lower:
        return "image/webp"
    else:
        # Default to JPEG
        return "image/jpeg"


def image_bytes_to_base64(content: bytes, mime_type: str) -> str:
    """Convert image bytes to base64 data URL.

    Args:
        content: Image binary data
        mime_type: MIME type

    Returns:
        data:image/...;base64,... format string
    """
    b64_data = base64.b64encode(content).decode("utf-8")
    result = f"data:{mime_type};base64,{b64_data}"

    logger.debug(f"image_bytes_to_base64: input={len(content)} bytes, output={len(b64_data)} chars")

    return result


async def url_to_base64(url: str) -> str:
    """Convert image URL to base64 data URL.

    Args:
        url: Image URL

    Returns:
        data:image/...;base64,... format string

    Raises:
        ImageError: If download or conversion fails
    """
    content, mime_type = await fetch_image_from_url(url)
    return image_bytes_to_base64(content, mime_type)


async def resolve_image_input(
    image_base64: str | None = None,
    image_url: str | None = None,
) -> str | None:
    """Resolve image input to base64 format.

    Prioritizes image_base64, falls back to downloading from image_url.

    Args:
        image_base64: Base64 format image data
        image_url: Image URL

    Returns:
        Base64 format image data, or None if no image

    Raises:
        ImageError: If URL download or conversion fails
    """
    logger.debug(
        f"resolve_image_input: base64={'yes' if image_base64 else 'no'}, url={'yes' if image_url else 'no'}"
    )

    # Prefer base64
    if image_base64:
        if is_base64_image(image_base64):
            logger.debug("Using provided base64 image")
            return image_base64
        else:
            logger.error("Invalid base64 image format")
            raise ImageError("图片编码格式无效，请上传有效图片。")

    # Try to download from URL
    if image_url:
        logger.debug("Downloading image from URL")
        result = await url_to_base64(image_url)
        logger.debug(f"Download complete, base64 length: {len(result)}")
        return result

    logger.debug("No image provided")
    return None
