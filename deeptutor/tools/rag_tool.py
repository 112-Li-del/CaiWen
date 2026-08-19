#!/usr/bin/env python
"""
RAG Query Tool - Pure tool wrapper for RAG operations

This module provides simple function wrappers for RAG operations.
All logic is delegated to RAGService in deeptutor/services/rag/service.py.
"""

import asyncio
from typing import Dict, List, Optional

# Import RAGService as the single entry point
from deeptutor.services.rag.service import DEFAULT_KB_BASE_DIR, RAGService

DEFAULT_KB_ALIASES = {"", "default", "current", "selected", "默认", "默认知识库", "当前知识库"}


def _annotate_sources(result: dict, *, kb_name: str, kb_ref: str) -> dict:
    """Attach the authorized KB identity without exposing storage paths."""
    for source in result.get("sources", []):
        if isinstance(source, dict):
            source["kb_name"] = kb_name
            source["kb_ref"] = kb_ref
    return result


def _resolve_kb_name(kb_name: Optional[str], kb_base_dir: Optional[str] = None) -> Optional[str]:
    """Resolve generic/default KB aliases to the configured default KB."""
    requested = str(kb_name or "").strip()
    try:
        from deeptutor.knowledge.manager import KnowledgeBaseManager

        manager = KnowledgeBaseManager(base_dir=kb_base_dir or DEFAULT_KB_BASE_DIR)
        kb_names = manager.list_knowledge_bases()
        if requested and requested in kb_names:
            return requested
        if requested.lower() in DEFAULT_KB_ALIASES:
            default_kb = manager.get_default()
            if default_kb:
                return default_kb
    except Exception:
        # Keep tool startup lightweight; the service will surface a concrete
        # retrieval error if the KB cannot be resolved from disk.
        pass
    return requested or None


async def rag_search(
    query: str,
    kb_name: Optional[str] = None,
    provider: Optional[str] = None,
    kb_base_dir: Optional[str] = None,
    event_sink=None,
    **kwargs,
) -> dict:
    """
    Query knowledge base using LlamaIndex RAG pipeline.

    Args:
        query: Query question
        kb_name: Knowledge base name (optional, defaults to default knowledge base)
        provider: RAG pipeline to use (defaults to configured provider or "llamaindex")
        kb_base_dir: Base directory for knowledge bases (for testing)
        **kwargs: Additional parameters passed to the RAG pipeline

    Returns:
        dict: Dictionary containing query results
            {
                "query": str,
                "answer": str,
                "content": str,
                "sources": list,
                "provider": str
            }
    """
    query = str(query or "").strip()
    if not query:
        raise ValueError("RAG query must be a non-empty string.")

    resolved_kb_ref = str(kb_name or "").strip()
    if kb_base_dir is None:
        try:
            from deeptutor.multi_user.context import get_current_user
            from deeptutor.multi_user.knowledge_access import resolve_for_rag

            resource = resolve_for_rag(kb_name)
            if resource is not None:
                kb_base_dir = str(resource.base_dir)
                kb_name = resource.name
                resolved_kb_ref = resource.id
            elif not get_current_user().is_admin:
                # Non-admin users must never silently fall back to admin's KB
                # directory. ``resolve_for_rag`` returning ``None`` means the
                # caller passed no kb_name at all — surface that as a
                # configuration error instead of leaking admin KBs.
                raise ValueError(
                    "No knowledge base selected. Pass kb_name explicitly or set a default."
                )
        except ValueError:
            raise
        except Exception as exc:
            if getattr(exc, "status_code", None) in {403, 404}:
                raise
            # Fall back to the legacy resolver so CLI/local single-user remains
            # tolerant when no request context exists. This branch only runs
            # for admin / single-user mode (the non-admin path raised above).
            pass

    service = RAGService(kb_base_dir=kb_base_dir, provider=provider)
    resolved_kb_name = _resolve_kb_name(kb_name, kb_base_dir=kb_base_dir)
    if not resolved_kb_name:
        raise ValueError("No knowledge base selected and no default knowledge base is configured.")

    try:
        result = await service.search(
            query=query,
            kb_name=resolved_kb_name,
            event_sink=event_sink,
            **kwargs,
        )
        return _annotate_sources(
            result,
            kb_name=resolved_kb_name,
            kb_ref=resolved_kb_ref or resolved_kb_name,
        )
    except Exception as e:
        raise Exception(f"RAG search failed: {e}")


async def rag_multi_search(
    query: str,
    kb_names: Optional[List[str]] = None,
    provider: Optional[str] = None,
    kb_base_dir: Optional[str] = None,
    event_sink=None,
    **kwargs,
) -> dict:
    """
    Query multiple knowledge bases in parallel and merge results.

    Args:
        query: Query question
        kb_names: List of knowledge base names to search (optional, defaults to default KB)
        provider: RAG pipeline to use (defaults to configured provider or "llamaindex")
        kb_base_dir: Base directory for knowledge bases (for testing)
        **kwargs: Additional parameters passed to the RAG pipeline

    Returns:
        dict: Merged results from all KBs with KB-name labels.
    """
    query = str(query or "").strip()
    if not query:
        raise ValueError("RAG query must be a non-empty string.")

    if kb_names is None:
        kb_names = []

    # Resolve KB access first. Multi-user resources may live under different
    # storage roots, so query each authorized resource with its own service.
    if kb_base_dir is None:
        try:
            from deeptutor.multi_user.context import get_current_user
            from deeptutor.multi_user.knowledge_access import resolve_for_rag

            resolved_resources = []
            for name in kb_names:
                resource = resolve_for_rag(name)
                if resource is not None:
                    resolved_resources.append(resource)
            if resolved_resources:
                async def _search_resource(resource):
                    service = RAGService(kb_base_dir=str(resource.base_dir), provider=provider)
                    result = await service.search(
                        query=query,
                        kb_name=resource.name,
                        event_sink=event_sink,
                        **kwargs,
                    )
                    return resource, _annotate_sources(
                        result, kb_name=resource.name, kb_ref=resource.id
                    )

                gathered = await asyncio.gather(
                    *(_search_resource(resource) for resource in resolved_resources),
                    return_exceptions=True,
                )
                answers: list[str] = []
                sources: list[dict] = []
                for item in gathered:
                    if isinstance(item, Exception):
                        continue
                    resource, result = item
                    answer = result.get("answer") or result.get("content") or ""
                    if str(answer).strip():
                        answers.append(f"【{resource.name}】\n{answer}")
                    sources.extend(
                        source for source in result.get("sources", []) if isinstance(source, dict)
                    )
                content = "\n\n".join(answers)
                return {
                    "query": query,
                    "answer": content,
                    "content": content,
                    "sources": sources,
                    "provider": provider or "llamaindex",
                    **({"rag_status": "no_results"} if not content else {}),
                }
            if not get_current_user().is_admin:
                raise ValueError(
                    "No knowledge base selected. Pass kb_names explicitly or set a default."
                )
        except ValueError:
            raise
        except Exception as exc:
            if getattr(exc, "status_code", None) in {403, 404}:
                raise
            pass

    service = RAGService(kb_base_dir=kb_base_dir, provider=provider)

    # Resolve each KB name (handle default aliases)
    resolved = []
    for name in kb_names:
        resolved_name = _resolve_kb_name(name, kb_base_dir=kb_base_dir)
        if resolved_name:
            resolved.append(resolved_name)

    if not resolved:
        raise ValueError("No knowledge base selected and no default knowledge base is configured.")

    if len(resolved) == 1:
        result = await service.search(
            query=query,
            kb_name=resolved[0],
            event_sink=event_sink,
            **kwargs,
        )
        return _annotate_sources(result, kb_name=resolved[0], kb_ref=resolved[0])

    try:
        result = await service.search_multi(
            query=query,
            kb_names=resolved,
            event_sink=event_sink,
            **kwargs,
        )
        for source in result.get("sources", []):
            if isinstance(source, dict):
                name = str(source.get("kb_name") or "")
                source["kb_ref"] = name
        return result
    except Exception as e:
        raise Exception(f"Multi-KB RAG search failed: {e}")


async def initialize_rag(
    kb_name: str,
    documents: List[str],
    provider: Optional[str] = None,
    kb_base_dir: Optional[str] = None,
    **kwargs,
) -> bool:
    """
    Initialize RAG with documents.

    Args:
        kb_name: Knowledge base name
        documents: List of document file paths to index
        provider: RAG pipeline to use (defaults to configured provider)
        kb_base_dir: Base directory for knowledge bases (for testing)
        **kwargs: Additional arguments passed to pipeline

    Returns:
        True if successful

    Example:
        documents = ["doc1.pdf", "doc2.txt"]
        success = await initialize_rag("my_kb", documents)
    """
    service = RAGService(kb_base_dir=kb_base_dir, provider=provider)
    return await service.initialize(kb_name=kb_name, file_paths=documents, **kwargs)


async def delete_rag(
    kb_name: str,
    provider: Optional[str] = None,
    kb_base_dir: Optional[str] = None,
) -> bool:
    """
    Delete a knowledge base.

    Args:
        kb_name: Knowledge base name
        provider: RAG pipeline to use (defaults to configured provider)
        kb_base_dir: Base directory for knowledge bases (for testing)

    Returns:
        True if successful

    Example:
        success = await delete_rag("old_kb")
    """
    service = RAGService(kb_base_dir=kb_base_dir, provider=provider)
    return await service.delete(kb_name=kb_name)


def get_available_providers() -> List[Dict]:
    """
    Get list of available RAG pipelines.

    Returns:
        List of pipeline information dictionaries

    Example:
        providers = get_available_providers()
        for p in providers:
            print(f"{p['name']}: {p['description']}")
    """
    return RAGService.list_providers()


def get_current_provider() -> str:
    """Get the currently configured RAG provider"""
    return RAGService.get_current_provider()


# Backward compatibility aliases
get_available_plugins = get_available_providers
list_providers = RAGService.list_providers


if __name__ == "__main__":
    import sys

    if sys.platform == "win32":
        import io

        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

    # List available providers
    print("Available RAG Pipelines:")
    for provider in get_available_providers():
        print(f"  - {provider['id']}: {provider['description']}")
    print(f"\nCurrent provider: {get_current_provider()}\n")

    # Test search (requires existing knowledge base)
    result = asyncio.run(
        rag_search(
            "What is the lookup table (LUT) in FPGA?",
            kb_name="DE-all",
        )
    )

    print(f"Query: {result['query']}")
    print(f"Answer: {result['answer']}")
    print(f"Provider: {result.get('provider', 'unknown')}")
