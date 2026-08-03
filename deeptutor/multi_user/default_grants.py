"""Per-instance default resource grants applied to newly registered users.

Each independently deployed 财问 (CaiWen) instance keeps its own ``default_grants``
config file under the admin workspace settings directory
(``data/user/settings/default_grants.json``).  An administrator checks which
LLM/embedding/search models and which public knowledge bases every newly
registered non-admin account should receive.  Nothing here is hard-coded —
all identifiers (model profile ids, model ids, knowledge-base names) are read
from the admin's model catalog and the admin knowledge-base workspace at the
time the config is applied, so the same code works on any deployment.

A configured default is only materialised into a user's grant if the
referenced resource still exists on this instance.  Resources deleted after the
config was saved are simply skipped, and resources added later only apply to
users who register after the admin updates the config.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from .grants import empty_grant, load_grant, save_grant
from .identity import get_user_by_id
from .knowledge_access import admin_kb_manager
from .model_access import admin_catalog
from .paths import get_admin_path_service

logger = logging.getLogger(__name__)

# Resolved via the admin PathService, so it lands in the instance's own
# ``data/user/settings/`` directory — one config per deployment.
CONFIG_FILE_NAME = "default_grants"

_SERVICES = ("llm", "embedding", "search")
_ADMIN_KB_PREFIX = "admin:kb:"


# ---------------------------------------------------------------------------
# Config persistence (one file per deployment)
# ---------------------------------------------------------------------------


def config_path() -> Path:
    """Return the on-disk path of this instance's default-grants config."""
    return get_admin_path_service().get_settings_file(CONFIG_FILE_NAME)


def empty_config() -> dict[str, Any]:
    return {
        "version": 1,
        "models": {"llm": [], "embedding": [], "search": []},
        "knowledge_bases": [],
    }


def normalize_config(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Coerce an arbitrary payload into the canonical config shape."""
    base = empty_config()
    if not isinstance(payload, dict):
        return base
    base["version"] = int(payload.get("version") or 1)
    models = payload.get("models") if isinstance(payload.get("models"), dict) else {}
    for service in _SERVICES:
        items = models.get(service) if isinstance(models, dict) else []
        if not isinstance(items, list):
            items = []
        base["models"][service] = [dict(item) for item in items if isinstance(item, dict)]
    kbs = payload.get("knowledge_bases")
    if isinstance(kbs, list):
        base["knowledge_bases"] = [dict(item) for item in kbs if isinstance(item, dict)]
    return base


def load_default_config() -> dict[str, Any]:
    path = config_path()
    if not path.exists():
        return empty_config()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("Failed to parse default-grants config at %s", path)
        return empty_config()
    return normalize_config(payload)


def save_default_config(config: dict[str, Any] | None) -> dict[str, Any]:
    """Persist the default-grants config for this deployment."""
    normalized = normalize_config(config)
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(normalized, indent=2, ensure_ascii=False), encoding="utf-8")
    logger.info(
        "Saved default-grants config: %d LLM, %d embedding, %d search, %d KBs",
        len(normalized["models"]["llm"]),
        len(normalized["models"]["embedding"]),
        len(normalized["models"]["search"]),
        len(normalized["knowledge_bases"]),
    )
    return normalized


# ---------------------------------------------------------------------------
# Resolve configured defaults against the current instance's live resources
# ---------------------------------------------------------------------------


def _profile_by_id(catalog: dict[str, Any], service: str, profile_id: str) -> dict[str, Any] | None:
    for profile in catalog.get("services", {}).get(service, {}).get("profiles", []) or []:
        if str(profile.get("id") or "") == profile_id:
            return profile
    return None


def _filter_model_items(items: list[dict[str, Any]], service: str) -> list[dict[str, Any]]:
    """Keep configured model grants whose profile (and models) still exist."""
    catalog = admin_catalog()
    out: list[dict[str, Any]] = []
    for item in items:
        pid = str(item.get("profile_id") or item.get("id") or "")
        if not pid:
            continue
        profile = _profile_by_id(catalog, service, pid)
        if profile is None:
            continue
        if service == "search":
            out.append({"profile_id": pid, "source": "admin"})
            continue
        model_ids = [str(m) for m in (item.get("model_ids") or []) if m]
        if not model_ids:
            continue
        existing = {
            str(m.get("id") or "") for m in (profile.get("models") or []) if isinstance(m, dict)
        }
        valid = [mid for mid in model_ids if mid in existing]
        if valid:
            out.append({"profile_id": pid, "model_ids": valid, "source": "admin"})
    return out


def _filter_kb_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep configured KB grants whose name still exists in the admin workspace."""
    try:
        existing = set(admin_kb_manager().list_knowledge_bases())
    except Exception:
        logger.exception("Failed to list admin knowledge bases for default grants")
        return []
    out: list[dict[str, Any]] = []
    for item in items:
        name = str(item.get("name") or "").strip()
        resource_id = str(item.get("resource_id") or item.get("id") or "")
        if resource_id.startswith(_ADMIN_KB_PREFIX):
            name = resource_id[len(_ADMIN_KB_PREFIX) :] or name
        name = name.strip()
        if not name or name not in existing:
            continue
        out.append(
            {
                "name": name,
                "resource_id": f"{_ADMIN_KB_PREFIX}{name}",
                "access": "read",
                "source": "admin",
            }
        )
    return out


def build_default_grant(user_id: str, config: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build a grant payload for *user_id* from the configured defaults.

    Only resources that still exist on this instance are included, so a stale
    config never grants access to a deleted profile or knowledge base.
    """
    cfg = normalize_config(config) if config is not None else load_default_config()
    grant = empty_grant(user_id)
    grant["version"] = 1
    grant["models"] = {
        "llm": _filter_model_items(cfg["models"]["llm"], "llm"),
        "embedding": _filter_model_items(cfg["models"]["embedding"], "embedding"),
        "search": _filter_model_items(cfg["models"]["search"], "search"),
    }
    grant["knowledge_bases"] = _filter_kb_items(cfg["knowledge_bases"])
    return grant


def _grant_has_content(grant: dict[str, Any]) -> bool:
    """True when a grant (or config) carries at least one model or KB entry."""
    return bool(grant.get("knowledge_bases")) or any(
        grant.get("models", {}).get(service) for service in _SERVICES
    )


def _model_count(grant: dict[str, Any]) -> int:
    return sum(len(grant.get("models", {}).get(service, []) or []) for service in _SERVICES)


def apply_default_grant(user_id: str) -> dict[str, Any] | None:
    """Read the instance's default config and grant it to an activated user.

    Returns the saved grant, or ``None`` when there is nothing to grant: no
    defaults configured on this instance (silent), the user is unknown or an
    admin, the account already holds a grant (duplicate-prevention), or
    persistence failed (exception fully logged).
    """
    config = load_default_config()
    if not _grant_has_content(config):
        logger.debug(
            "apply_default_grant: no default grants configured on this instance "
            "(config file missing or empty) — user_id=%s skipped silently",
            user_id,
        )
        return None

    user_record = get_user_by_id(user_id)
    if user_record is None:
        logger.warning("apply_default_grant: unknown user_id=%s", user_id)
        return None
    username, record = user_record
    if str(record.get("role") or "user") == "admin":
        logger.info(
            "apply_default_grant: user '%s' (id=%s) is an admin — skipping",
            username,
            user_id,
        )
        return None

    logger.info(
        "apply_default_grant: loaded instance default config for user '%s' (id=%s) — "
        "llm=%d embedding=%d search=%d kbs=%s",
        username,
        user_id,
        len(config.get("models", {}).get("llm", []) or []),
        len(config.get("models", {}).get("embedding", []) or []),
        len(config.get("models", {}).get("search", []) or []),
        json.dumps(
            [
                str(kb.get("name") or kb.get("resource_id") or "")
                for kb in config.get("knowledge_bases", []) or []
            ],
            ensure_ascii=False,
        ),
    )

    existing = load_grant(user_id)
    if _grant_has_content(existing):
        logger.info(
            "apply_default_grant: user '%s' (id=%s) already has %d model grant(s) and "
            "%d KB grant(s) — skipping duplicate application",
            username,
            user_id,
            _model_count(existing),
            len(existing.get("knowledge_bases", []) or []),
        )
        return existing

    try:
        grant = build_default_grant(user_id, config)
        logger.info(
            "apply_default_grant: granting user '%s' (id=%s) — models=%s kbs=%s",
            username,
            user_id,
            json.dumps(grant.get("models", {}), ensure_ascii=False),
            json.dumps(
                [kb.get("name") for kb in grant.get("knowledge_bases", []) or []],
                ensure_ascii=False,
            ),
        )
        for service in _SERVICES:
            for item in grant.get("models", {}).get(service, []) or []:
                detail = f" model_ids={item.get('model_ids')}" if service != "search" else ""
                logger.info(
                    "apply_default_grant: [%s] granted profile_id=%s%s",
                    service,
                    item.get("profile_id"),
                    detail,
                )
        for kb in grant.get("knowledge_bases", []) or []:
            logger.info(
                "apply_default_grant: [knowledge_base] granted read-only '%s' (%s)",
                kb.get("name"),
                kb.get("resource_id"),
            )

        saved = save_grant(user_id, grant)
        logger.info(
            "apply_default_grant: saved grant for user '%s' (id=%s) — %d model grant(s), "
            "%d KB grant(s)",
            username,
            user_id,
            _model_count(saved),
            len(saved.get("knowledge_bases", []) or []),
        )
        return saved
    except Exception:
        logger.exception(
            "apply_default_grant: FAILED to apply default grant for user '%s' (id=%s)",
            username,
            user_id,
        )
        return None
