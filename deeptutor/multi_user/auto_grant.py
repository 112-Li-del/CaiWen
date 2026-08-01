"""Auto-assign default resource grants when a new non-admin user registers.

This module ensures every new user can immediately use the system without
waiting for an admin to manually assign models, search, and knowledge bases.
"""

from __future__ import annotations

import logging
from typing import Any

from .grants import empty_grant, save_grant
from .identity import get_user_by_id
from .knowledge_access import admin_kb_manager
from .model_access import admin_catalog

logger = logging.getLogger(__name__)

# Knowledge-base names that every new user receives read-only access to.
DEFAULT_KB_NAMES = ("学生手册", "学生课表", "招生政策")

# Fallback profile name matchers used when the catalog layout is non-standard.
DEFAULT_LLM_PROFILE_NAMES = ("Default LLM Endpoint", "default", "Default")
DEFAULT_EMBEDDING_PROFILE_NAMES = ("Default Embedding Endpoint", "default", "Default")
DEFAULT_SEARCH_PROFILE_NAMES = ("Default Search Provider", "default", "Default")


def _find_profile(
    catalog: dict[str, Any], service: str, preferred_names: tuple[str, ...]
) -> dict[str, Any] | None:
    """Return the first profile in *catalog* whose name matches *preferred_names*."""
    services = catalog.get("services", {}) if isinstance(catalog, dict) else {}
    profiles = services.get(service, {}).get("profiles", []) or []
    if not profiles:
        return None
    name_lower_map = {
        str(p.get("name") or "").strip().lower(): p for p in profiles if isinstance(p, dict)
    }
    for preferred in preferred_names:
        match = name_lower_map.get(preferred.lower())
        if match is not None:
            return match
    # Fallback: return the first profile.
    first = profiles[0]
    return first if isinstance(first, dict) else None


def _build_default_grant(user_id: str) -> dict[str, Any]:
    """Build a grant payload that gives access to every available resource."""
    grant = empty_grant(user_id)
    catalog = admin_catalog()

    # ---- LLM profiles & models ----
    services = catalog.get("services", {}) if isinstance(catalog, dict) else {}
    llm_profiles = services.get("llm", {}).get("profiles", []) or []
    for profile in llm_profiles:
        if not isinstance(profile, dict):
            continue
        pid = str(profile.get("id") or "")
        if not pid:
            continue
        model_ids = [str(m.get("id") or "") for m in (profile.get("models") or []) if isinstance(m, dict) and m.get("id")]
        grant["models"]["llm"].append(
            {"profile_id": pid, "model_ids": model_ids if model_ids else [pid]}
        )

    # ---- Embedding profiles & models ----
    emb_profiles = services.get("embedding", {}).get("profiles", []) or []
    for profile in emb_profiles:
        if not isinstance(profile, dict):
            continue
        pid = str(profile.get("id") or "")
        if not pid:
            continue
        model_ids = [str(m.get("id") or "") for m in (profile.get("models") or []) if isinstance(m, dict) and m.get("id")]
        grant["models"]["embedding"].append(
            {"profile_id": pid, "model_ids": model_ids if model_ids else [pid]}
        )

    # ---- Search profiles ----
    search_profiles = services.get("search", {}).get("profiles", []) or []
    for profile in search_profiles:
        if not isinstance(profile, dict):
            continue
        pid = str(profile.get("id") or "")
        if pid:
            grant["models"]["search"].append({"profile_id": pid})

    # ---- Knowledge bases ----
    try:
        admin_kb = admin_kb_manager()
        all_kb_names = set(admin_kb.list_knowledge_bases())
        for kb_name in DEFAULT_KB_NAMES:
            if kb_name in all_kb_names:
                grant["knowledge_bases"].append(
                    {
                        "name": kb_name,
                        "resource_id": f"admin:kb:{kb_name}",
                        "access": "read",
                    }
                )
            else:
                logger.debug(
                    "Default KB '%s' not found in admin workspace — skipping auto-assign",
                    kb_name,
                )
    except Exception:
        logger.exception("Failed to list admin knowledge bases for auto-grant")

    return grant


def auto_assign_defaults(user_id: str) -> dict[str, Any] | None:
    """Assign default resources to a newly registered non-admin user.

    Returns the saved grant on success, or ``None`` if the user shouldn't
    receive a grant (e.g. they are an admin).
    """
    user_record = get_user_by_id(user_id)
    if user_record is None:
        logger.warning("auto_assign_defaults: unknown user_id=%s", user_id)
        return None

    _username, record = user_record
    if str(record.get("role") or "user") == "admin":
        logger.info("Skipping auto-grant for admin user '%s'", record.get("username", user_id))
        return None

    try:
        grant = _build_default_grant(user_id)
        saved = save_grant(user_id, grant)
        logger.info(
            "Auto-assigned default grant for user '%s': %d LLM, %d embedding, %d search, %d KBs",
            record.get("username", user_id),
            len(saved.get("models", {}).get("llm", [])),
            len(saved.get("models", {}).get("embedding", [])),
            len(saved.get("models", {}).get("search", [])),
            len(saved.get("knowledge_bases", [])),
        )
        return saved
    except Exception:
        logger.exception("Failed to auto-assign grant for user_id=%s", user_id)
        return None
