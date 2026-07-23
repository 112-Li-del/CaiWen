"""LlamaIndex-backed RAG pipeline orchestration."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
import traceback
from typing import Any, Callable, Dict, List, Optional

from deeptutor.services.embedding import get_embedding_config
from deeptutor.services.rag.embedding_signature import signature_from_embedding_config
from deeptutor.services.rag.index_versioning import (
    EmbeddingSignature,
    resolve_storage_dir_for_read,
    resolve_storage_dir_for_rebuild,
    write_version_meta,
)

from . import storage
from .document_loader import LlamaIndexDocumentLoader
from .embedding_adapter import (
    configure_llamaindex_settings,
    set_progress_callback,
    verify_embedding_connectivity,
)
from .errors import search_error_result

DEFAULT_KB_BASE_DIR = str(
    Path(__file__).resolve().parent.parent.parent.parent.parent.parent / "data" / "knowledge_bases"
)

SignatureProvider = Callable[[], EmbeddingSignature | None]

# Minimum cosine-similarity score for a retrieved chunk to be considered
# relevant enough to include in results. Chunks below this threshold are
# discarded. Tune via RAG_SCORE_THRESHOLD in .env (e.g. 0.3).


def _load_rag_score_threshold() -> float:
    """Read RAG_SCORE_THRESHOLD from os.environ, then .env, default 0.3."""
    val = os.environ.get("RAG_SCORE_THRESHOLD")
    if val:
        return float(val)
    env_path = Path(__file__).resolve().parent.parent.parent.parent.parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped.startswith("RAG_SCORE_THRESHOLD="):
                v = stripped.split("=", 1)[1].strip().strip("\"'")
                if v:
                    return float(v)
    return 0.3


_RAG_SCORE_THRESHOLD = _load_rag_score_threshold()


class LlamaIndexPipeline:
    """Pipeline that indexes and retrieves KB content via LlamaIndex."""

    def __init__(
        self,
        kb_base_dir: Optional[str] = None,
        *,
        signature_provider: SignatureProvider | None = None,
        document_loader: LlamaIndexDocumentLoader | None = None,
    ):
        self.logger = logging.getLogger(__name__)
        self.kb_base_dir = kb_base_dir or DEFAULT_KB_BASE_DIR
        self._signature_provider = signature_provider or signature_from_embedding_config
        self.document_loader = document_loader or LlamaIndexDocumentLoader(self.logger)
        self._configure_settings()

    def _configure_settings(self) -> None:
        configure_llamaindex_settings(self.logger)

    async def _verify_embedding_connectivity(self) -> None:
        await verify_embedding_connectivity(self.logger)

    def _current_signature(self) -> EmbeddingSignature | None:
        return self._signature_provider()

    def _cleanup_failed_version_dir(self, storage_dir: Path, signature: Optional[Any]) -> None:
        _ = signature
        try:
            if storage.cleanup_failed_version_dir(storage_dir):
                self.logger.info(
                    f"Removed empty version dir after failed pipeline run: {storage_dir}"
                )
        except Exception as cleanup_exc:  # pragma: no cover - best-effort
            self.logger.warning(
                f"Could not clean up failed version dir for {storage_dir}: {cleanup_exc}"
            )

    async def initialize(self, kb_name: str, file_paths: List[str], **kwargs) -> bool:
        progress_callback = kwargs.get("progress_callback")
        self._configure_settings()

        self.logger.info(
            f"Initializing KB '{kb_name}' with {len(file_paths)} files using LlamaIndex"
        )

        kb_dir = Path(self.kb_base_dir) / kb_name
        signature = self._current_signature()
        storage_dir = resolve_storage_dir_for_rebuild(kb_dir, signature)

        try:
            await self._verify_embedding_connectivity()
            documents = await self.document_loader.load(file_paths)
            if not documents:
                self.logger.error("No valid documents found")
                return False

            self.logger.info(
                f"Creating VectorStoreIndex with {len(documents)} documents "
                f"(chunking + embedding)..."
            )

            if progress_callback:
                set_progress_callback(progress_callback)

            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: storage.create_index(documents, storage_dir, show_progress=True),
            )

            self.logger.info(f"Index persisted to {storage_dir}")
            if signature is not None:
                write_version_meta(kb_dir, signature, storage_dir=storage_dir)

            self.logger.info(f"KB '{kb_name}' initialized successfully with LlamaIndex")
            return True

        except Exception as exc:
            self.logger.error(f"Failed to initialize KB: {exc}")
            self.logger.error(traceback.format_exc())
            self._cleanup_failed_version_dir(storage_dir, signature)
            raise
        finally:
            set_progress_callback(None)

    async def search(
        self,
        query: str,
        kb_name: str,
        **kwargs,
    ) -> Dict[str, Any]:
        kwargs.pop("mode", None)
        self._configure_settings()
        self.logger.info(f"Searching KB '{kb_name}' with query: {query[:50]}...")

        kb_dir = Path(self.kb_base_dir) / kb_name
        signature = self._current_signature()
        storage_dir = resolve_storage_dir_for_read(kb_dir, signature)

        if storage_dir is None or not (storage_dir / "docstore.json").exists():
            self.logger.warning(
                f"No matching index found for KB '{kb_name}' at signature "
                f"{signature.hash() if signature else 'n/a'}"
            )
            return {
                "query": query,
                "answer": (
                    "This knowledge base has no index for the active embedding "
                    "model. Re-index it (or switch back to a previously-used "
                    "embedding model) before querying."
                ),
                "content": "",
                "provider": "llamaindex",
                "needs_reindex": True,
            }

        embedding_mismatch_warning = self._embedding_mismatch_warning(kb_name)

        try:
            loop = asyncio.get_event_loop()
            top_k = kwargs.get("top_k", 5)
            nodes = await loop.run_in_executor(
                None,
                lambda: storage.retrieve_nodes(storage_dir, query, top_k=top_k),
            )

            result = self._nodes_to_result(query, nodes)
            if embedding_mismatch_warning:
                result["warning"] = embedding_mismatch_warning
            return result

        except Exception as exc:
            result = search_error_result(query, exc)
            if result.get("error_type"):
                log_message = result.get("log_message") or str(exc)
                self.logger.warning(f"Search failed ({result['error_type']}): {log_message}")
            else:
                self.logger.error(f"Search failed: {exc}")
                self.logger.error(traceback.format_exc())
            return result

    def _embedding_mismatch_warning(self, kb_name: str) -> str:
        try:
            cfg_path = Path(self.kb_base_dir) / "kb_config.json"
            if not cfg_path.exists():
                return ""
            with open(cfg_path, encoding="utf-8") as handle:
                kb_entry = json.load(handle).get("knowledge_bases", {}).get(kb_name, {})
            if not kb_entry.get("embedding_mismatch"):
                return ""
            stored = kb_entry.get("embedding_model", "unknown")
            current = get_embedding_config().model
            warning = (
                f"Warning: KB '{kb_name}' was indexed with '{stored}' "
                f"but current model is '{current}'. Re-index recommended."
            )
            self.logger.warning(warning)
            return warning
        except Exception:
            return ""

    def _nodes_to_result(self, query: str, nodes: list[Any]) -> Dict[str, Any]:
        context_parts: list[str] = []
        sources: list[dict[str, Any]] = []

        for i, node in enumerate(nodes):
            meta = node.node.metadata or {}
            score_val = node.score
            score = round(float(score_val), 4) if score_val is not None else 0.0

            # Discard chunks whose similarity score is below the configured
            # threshold — they are noise, not genuine matches.
            if score < _RAG_SCORE_THRESHOLD:
                continue

            context_parts.append(node.node.text)
            sources.append(
                {
                    "type": "rag",
                    "title": meta.get("file_name", meta.get("title", f"Document {i + 1}")),
                    "content": node.node.text[:200],
                    "content_preview": node.node.text[:200],
                    "source": meta.get("file_path", meta.get("file_name", "")),
                    "source_file": meta.get("file_path", meta.get("file_name", "")),
                    "page": meta.get("page_label", meta.get("page", "")),
                    "chunk_id": node.node.node_id or str(i),
                    "score": score,
                }
            )

        content = "\n\n".join(context_parts) if context_parts else ""
        result: dict[str, Any] = {
            "query": query,
            "answer": content,
            "content": content,
            "sources": sources,
            "provider": "llamaindex",
        }
        if not context_parts:
            result["rag_status"] = "no_results"
        return result

    async def add_documents(self, kb_name: str, file_paths: List[str], **kwargs) -> bool:
        progress_callback = kwargs.get("progress_callback")
        self._configure_settings()

        self.logger.info(f"Adding {len(file_paths)} documents to KB '{kb_name}' using LlamaIndex")

        kb_dir = Path(self.kb_base_dir) / kb_name
        signature = self._current_signature()
        plan = storage.resolve_add_storage_plan(kb_dir, signature)

        try:
            await self._verify_embedding_connectivity()
            if progress_callback:
                set_progress_callback(progress_callback)

            documents = await self.document_loader.load(file_paths)
            if not documents:
                self.logger.warning("No valid documents to add")
                return False

            loop = asyncio.get_event_loop()

            if plan.existing_storage is not None:
                self.logger.info(f"Loading existing index from {plan.existing_storage}...")
                num_added = await loop.run_in_executor(
                    None,
                    lambda: storage.insert_documents(
                        plan.existing_storage, plan.storage_dir, documents
                    ),
                )
                self.logger.info(f"Added {num_added} documents to existing index")
                if signature is not None and plan.storage_dir != plan.existing_storage:
                    write_version_meta(kb_dir, signature, storage_dir=plan.storage_dir)
            else:
                self.logger.info(f"Creating new index with {len(documents)} documents...")
                plan.storage_dir.mkdir(parents=True, exist_ok=True)
                num_added = await loop.run_in_executor(
                    None,
                    lambda: storage.create_index(documents, plan.storage_dir, show_progress=True),
                )
                self.logger.info(f"Created new index with {num_added} documents")
                if signature is not None:
                    write_version_meta(kb_dir, signature, storage_dir=plan.storage_dir)

            self.logger.info(f"Successfully added documents to KB '{kb_name}'")
            return True

        except Exception as exc:
            self.logger.error(f"Failed to add documents: {exc}")
            self.logger.error(traceback.format_exc())
            if plan.existing_storage is None or plan.storage_dir != plan.existing_storage:
                self._cleanup_failed_version_dir(plan.storage_dir, signature)
            raise
        finally:
            set_progress_callback(None)

    async def remove_document(self, kb_name: str, file_path: str) -> dict[str, Any]:
        """Surgically remove a single document's chunks from all ready index versions.

        Returns a dict with:
        * ``removed`` — total number of ref_docs removed across all versions
        * ``versions_checked`` — number of ready versions that were inspected
        * ``versions_modified`` — number of versions from which nodes were removed
        * ``errors`` — list of per-version error strings (non-fatal; the caller
          can decide to fall back to a full reindex if every version failed)
        """
        kb_dir = Path(self.kb_base_dir) / kb_name
        from deeptutor.services.rag.index_versioning import list_kb_versions

        all_versions = list_kb_versions(kb_dir)
        ready_versions = [v for v in all_versions if v.get("ready")]

        if not ready_versions:
            self.logger.info("No ready index versions for KB '%s'; nothing to remove from.", kb_name)
            return {
                "removed": 0,
                "versions_checked": 0,
                "versions_modified": 0,
                "errors": [],
            }

        total_removed = 0
        versions_modified = 0
        errors: list[str] = []

        for version_entry in ready_versions:
            storage_dir = Path(str(version_entry["storage_path"]))
            version_label = version_entry.get("version", str(storage_dir))
            if not storage_dir.is_dir():
                self.logger.warning(
                    "Version '%s' storage dir %s is missing; skipping.", version_label, storage_dir
                )
                continue

            try:
                removed = storage.remove_document_nodes(storage_dir, file_path)
                total_removed += removed
                if removed > 0:
                    versions_modified += 1
            except Exception as exc:
                err_msg = f"Version '{version_label}': {exc}"
                self.logger.warning(
                    "Failed to remove document from version '%s': %s", version_label, exc
                )
                errors.append(err_msg)

        return {
            "removed": total_removed,
            "versions_checked": len(ready_versions),
            "versions_modified": versions_modified,
            "errors": errors,
        }

    async def delete(self, kb_name: str) -> bool:
        kb_dir = Path(self.kb_base_dir) / kb_name
        deleted = storage.delete_kb_dir(kb_dir)
        if deleted:
            self.logger.info(f"Deleted KB '{kb_name}'")
        return deleted
