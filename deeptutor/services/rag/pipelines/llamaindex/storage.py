"""Storage operations for the LlamaIndex RAG pipeline."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import shutil
from typing import Any

from llama_index.core import StorageContext, VectorStoreIndex, load_index_from_storage

from deeptutor.services.embedding.validation import validate_embedding_batch
from deeptutor.services.rag.index_versioning import (
    EmbeddingSignature,
    find_matching_version,
    list_kb_versions,
    resolve_storage_dir_for_read,
    resolve_storage_dir_for_write,
)


@dataclass(frozen=True)
class AddStoragePlan:
    existing_storage: Path | None
    storage_dir: Path


def cleanup_failed_version_dir(storage_dir: Path) -> bool:
    """Remove an empty flat version dir created by a failed indexing attempt."""
    if not storage_dir.is_dir() or not storage_dir.name.startswith("version-"):
        return False
    storage_empty = not any(child for child in storage_dir.iterdir() if child.name != "meta.json")
    meta_path = storage_dir / "meta.json"
    if storage_empty and not meta_path.exists():
        shutil.rmtree(storage_dir, ignore_errors=True)
        return True
    return False


def resolve_add_storage_plan(kb_dir: Path, signature: EmbeddingSignature | None) -> AddStoragePlan:
    """Choose existing/new storage dirs for incremental adds."""
    matching_version = find_matching_version(kb_dir, signature) if signature is not None else None
    existing_storage = Path(str(matching_version["storage_path"])) if matching_version else None

    if signature is not None and matching_version is None:
        has_ready_index = any(bool(entry.get("ready")) for entry in list_kb_versions(kb_dir))
        if has_ready_index:
            raise ValueError(
                "Knowledge base requires a full reindex before incremental documents can be added"
            )

    if matching_version and matching_version.get("layout") == "flat":
        return AddStoragePlan(existing_storage=existing_storage, storage_dir=existing_storage)

    if matching_version:
        return AddStoragePlan(
            existing_storage=existing_storage,
            storage_dir=resolve_storage_dir_for_write(kb_dir, signature),
        )

    fallback_storage = resolve_storage_dir_for_read(kb_dir, signature)
    existing_storage = fallback_storage
    fallback_is_flat = (
        fallback_storage is not None
        and fallback_storage.parent == kb_dir
        and fallback_storage.name.startswith("version-")
    )
    storage_dir = (
        fallback_storage if fallback_is_flat else resolve_storage_dir_for_write(kb_dir, signature)
    )
    return AddStoragePlan(existing_storage=existing_storage, storage_dir=storage_dir)


def create_index(documents: list[Any], storage_dir: Path, *, show_progress: bool = True) -> int:
    index = VectorStoreIndex.from_documents(documents, show_progress=show_progress)
    index.storage_context.persist(persist_dir=str(storage_dir))
    return len(documents)


def insert_documents(existing_storage: Path, storage_dir: Path, documents: list[Any]) -> int:
    storage_context = StorageContext.from_defaults(persist_dir=str(existing_storage))
    index = load_index_from_storage(storage_context)
    _validate_persisted_embeddings(index, existing_storage)
    for document in documents:
        index.insert(document)
    index.storage_context.persist(persist_dir=str(storage_dir))
    return len(documents)


def _validate_embedding_dict(embedding_dict: Any, *, label: str) -> None:
    if not isinstance(embedding_dict, dict) or not embedding_dict:
        return

    validate_embedding_batch(
        list(embedding_dict.values()),
        expected_count=len(embedding_dict),
        binding="llamaindex",
        model=f"persisted-index:{label}",
    )


def _iter_index_embedding_dicts(index: Any):
    """Yield embedding dictionaries exposed by loaded LlamaIndex vector stores."""
    seen: set[int] = set()

    def _yield_store(label: str, vector_store: Any):
        if vector_store is None:
            return
        store_id = id(vector_store)
        if store_id in seen:
            return
        seen.add(store_id)
        data = getattr(vector_store, "data", None)
        embedding_dict = getattr(data, "embedding_dict", None)
        if isinstance(embedding_dict, dict):
            yield label, embedding_dict

    yield from _yield_store("default", getattr(index, "vector_store", None))

    storage_context = getattr(index, "storage_context", None)
    vector_stores = getattr(storage_context, "vector_stores", None)
    if isinstance(vector_stores, dict):
        for namespace, vector_store in vector_stores.items():
            yield from _yield_store(str(namespace), vector_store)


def _embedding_dict_from_payload(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return None
    if isinstance(payload.get("embedding_dict"), dict):
        return payload["embedding_dict"]
    data = payload.get("data")
    if isinstance(data, dict) and isinstance(data.get("embedding_dict"), dict):
        return data["embedding_dict"]
    return None


def _iter_file_embedding_dicts(storage_dir: Path):
    """Yield embedding dictionaries from persisted vector-store JSON files."""
    for path in sorted(storage_dir.glob("*vector_store.json")):
        try:
            with open(path, encoding="utf-8") as handle:
                payload = json.load(handle)
        except Exception:
            continue
        embedding_dict = _embedding_dict_from_payload(payload)
        if isinstance(embedding_dict, dict):
            yield path.name, embedding_dict


def _validate_persisted_embeddings(index: Any, storage_dir: Path | None = None) -> None:
    """Fail early when a persisted vector store contains unusable vectors."""
    try:
        for label, embedding_dict in _iter_index_embedding_dicts(index):
            _validate_embedding_dict(embedding_dict, label=label)
        if storage_dir is not None:
            for label, embedding_dict in _iter_file_embedding_dicts(storage_dir):
                _validate_embedding_dict(embedding_dict, label=label)
    except ValueError as exc:
        raise ValueError(
            "RAG index contains invalid embedding vectors. Re-index the "
            "knowledge base with the current embedding provider/model before "
            f"querying it again. Details: {exc}"
        ) from exc


def validate_storage_embeddings(storage_dir: Path) -> None:
    """Validate persisted vector-store files without running a retrieval."""
    _validate_persisted_embeddings(None, storage_dir)


def retrieve_nodes(storage_dir: Path, query: str, *, top_k: int = 5) -> list[Any]:
    storage_context = StorageContext.from_defaults(persist_dir=str(storage_dir))
    index = load_index_from_storage(storage_context)
    _validate_persisted_embeddings(index, storage_dir)
    retriever = index.as_retriever(similarity_top_k=top_k)
    return retriever.retrieve(query)


def delete_kb_dir(kb_dir: Path) -> bool:
    if kb_dir.exists():
        shutil.rmtree(kb_dir)
        return True
    return False


def remove_document_nodes(storage_dir: Path, file_path: str) -> int:
    """Surgically remove all nodes belonging to a single source file from an index.

    Loads the persisted index at ``storage_dir``, finds every ``ref_doc`` whose
    node metadata references ``file_path`` (matched against the ``file_path``
    and ``file_name`` metadata fields), deletes those ref-docs from the vector
    store, docstore, and index store, then persists the updated stores back
    to disk.

    Returns the number of ``ref_doc`` entries that were removed (0 means no
    matching document was found in this index version).

    Raises ``ValueError`` if the storage directory does not contain a loadable
    index. Other errors (e.g. corrupt vector store) propagate to the caller so
    the orchestrator can decide whether to fall back to a full rebuild.
    """
    import logging

    _logger = logging.getLogger(__name__)

    if not storage_dir.is_dir() or not (storage_dir / "docstore.json").exists():
        raise ValueError(f"No loadable index found at {storage_dir}")

    storage_context = StorageContext.from_defaults(persist_dir=str(storage_dir))
    index = load_index_from_storage(storage_context)

    # Normalise the target path for cross-platform comparison
    target_path = str(Path(file_path).resolve())
    target_name = Path(file_path).name

    ref_doc_ids_to_delete: list[str] = []
    for ref_doc_id, ref_doc_info in index.ref_doc_info.items():
        if not ref_doc_info.node_ids:
            continue
        sample_node_id = ref_doc_info.node_ids[0]
        try:
            sample_node = index.docstore.get_node(sample_node_id)
        except Exception:
            # Node may have been partially cleaned up; inspect remaining nodes
            found = False
            for nid in ref_doc_info.node_ids:
                try:
                    sample_node = index.docstore.get_node(nid)
                    found = True
                    break
                except Exception:
                    continue
            if not found:
                _logger.warning(
                    "ref_doc %s has no retrievable nodes; skipping", ref_doc_id
                )
                continue

        metadata = getattr(sample_node, "metadata", {}) or {}
        node_file_path = str(metadata.get("file_path", ""))
        node_file_name = str(metadata.get("file_name", ""))

        # Match by full path (preferred) or by filename (fallback for
        # indexes created before file_path was reliably stored).
        if node_file_path:
            node_resolved = str(Path(node_file_path).resolve())
            if node_resolved == target_path:
                ref_doc_ids_to_delete.append(ref_doc_id)
                continue
        if node_file_name and node_file_name == target_name:
            ref_doc_ids_to_delete.append(ref_doc_id)

    if not ref_doc_ids_to_delete:
        _logger.info(
            "No index nodes found for file '%s' in %s", target_name, storage_dir
        )
        return 0

    for ref_doc_id in ref_doc_ids_to_delete:
        try:
            index.delete_ref_doc(ref_doc_id, delete_from_docstore=True)
        except TypeError:
            # Older llama_index versions don't accept the kwarg
            index.delete_ref_doc(ref_doc_id)

    index.storage_context.persist(persist_dir=str(storage_dir))
    _logger.info(
        "Removed %d ref_doc(s) for file '%s' from %s",
        len(ref_doc_ids_to_delete),
        target_name,
        storage_dir,
    )
    return len(ref_doc_ids_to_delete)
