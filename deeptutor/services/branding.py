"""Product branding shared by user-facing agents and prompt templates."""

from __future__ import annotations

import os
import re
from typing import Any

from deeptutor.services.config import get_env_store

BRAND_ENV_KEY = "BRAND_NAME"
DEFAULT_BRAND_NAME = "财问"
BRAND_PLACEHOLDER = "{{BRAND_NAME}}"
LEGACY_BRAND_NAMES = ("DeepTutor",)

_LEGACY_BRAND_PATTERN = re.compile(
    r"(?<![A-Za-z0-9_])(?:" + "|".join(map(re.escape, LEGACY_BRAND_NAMES)) + r")(?![A-Za-z0-9_])",
    re.IGNORECASE,
)


def get_brand_name() -> str:
    """Return the configured product name, falling back to 财问."""
    environment_value = os.getenv(BRAND_ENV_KEY, "").strip()
    if environment_value:
        return environment_value

    configured_value = get_env_store().get(BRAND_ENV_KEY, "").strip()
    return configured_value or DEFAULT_BRAND_NAME


def substitute_brand_placeholders(data: Any, brand_name: str | None = None) -> Any:
    """Replace explicit brand placeholders without rewriting technical names."""
    resolved_brand = brand_name or get_brand_name()
    if isinstance(data, str):
        return data.replace(BRAND_PLACEHOLDER, resolved_brand)
    if isinstance(data, dict):
        return {
            key: substitute_brand_placeholders(value, resolved_brand)
            for key, value in data.items()
        }
    if isinstance(data, list):
        return [substitute_brand_placeholders(value, resolved_brand) for value in data]
    return data


def normalize_inherited_brand(data: Any, brand_name: str | None = None) -> Any:
    """Rewrite legacy names in inherited model output, leaving user text untouched."""
    resolved_brand = brand_name or get_brand_name()
    if resolved_brand.casefold() in {name.casefold() for name in LEGACY_BRAND_NAMES}:
        return data
    if isinstance(data, str):
        return _LEGACY_BRAND_PATTERN.sub(resolved_brand, data)
    if isinstance(data, list):
        normalized: list[Any] = []
        for part in data:
            if isinstance(part, dict) and part.get("type") == "text":
                updated_part = dict(part)
                updated_part["text"] = normalize_inherited_brand(
                    part.get("text", ""), resolved_brand
                )
                normalized.append(updated_part)
            else:
                normalized.append(part)
        return normalized
    return data


__all__ = [
    "BRAND_ENV_KEY",
    "BRAND_PLACEHOLDER",
    "DEFAULT_BRAND_NAME",
    "LEGACY_BRAND_NAMES",
    "get_brand_name",
    "normalize_inherited_brand",
    "substitute_brand_placeholders",
]
