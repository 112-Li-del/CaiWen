from __future__ import annotations

import json
from pathlib import Path

import pytest

from deeptutor.services.rag.index_versioning import (
    EmbeddingSignature,
    advance_corpus_revision,
    find_matching_version,
    list_kb_versions,
    write_version_meta,
)


def _signature() -> EmbeddingSignature:
    return EmbeddingSignature(
        binding="openai",
        model="embed-a",
        dimension=1024,
        base_url="https://example.test/v1",
        api_version="",
    )


@pytest.mark.asyncio
async def test_incremental_add_rejects_legacy_index_until_full_reindex(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from deeptutor.services.rag.pipelines.llamaindex.pipeline import LlamaIndexPipeline

    sig = _signature()
    kb_dir = tmp_path / "kb"
    raw_file = kb_dir / "raw" / "new.txt"
    raw_file.parent.mkdir(parents=True)
    raw_file.write_text("new content", encoding="utf-8")

    legacy_version_dir = kb_dir / "index_versions" / sig.hash()
    legacy_storage_dir = legacy_version_dir / "llamaindex_storage"
    legacy_storage_dir.mkdir(parents=True)
    (legacy_storage_dir / "docstore.json").write_text("{}", encoding="utf-8")
    (legacy_version_dir / "meta.json").write_text(
        json.dumps({"signature": sig.hash(), "version": sig.hash()}),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        LlamaIndexPipeline,
        "_configure_settings",
        lambda self: None,
    )

    pipeline = LlamaIndexPipeline(
        kb_base_dir=str(tmp_path),
        signature_provider=lambda: sig,
    )

    with pytest.raises(ValueError, match="full reindex"):
        await pipeline.add_documents("kb", [str(raw_file)])

    assert not (kb_dir / "version-1").exists()


@pytest.mark.asyncio
async def test_full_reindex_with_no_documents_does_not_allocate_empty_version(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from deeptutor.services.rag.pipelines.llamaindex.pipeline import LlamaIndexPipeline

    class _EmptyLoader:
        async def load(self, _file_paths):
            return []

    monkeypatch.setattr(LlamaIndexPipeline, "_configure_settings", lambda self: None)
    monkeypatch.setattr(
        LlamaIndexPipeline,
        "_verify_embedding_connectivity",
        lambda self: _completed(),
    )
    pipeline = LlamaIndexPipeline(
        kb_base_dir=str(tmp_path),
        signature_provider=_signature,
        document_loader=_EmptyLoader(),
    )

    success = await pipeline.initialize("kb", ["scan.pdf"])

    assert success is False
    assert not (tmp_path / "kb" / "version-1").exists()


async def _completed() -> None:
    return None


@pytest.mark.asyncio
async def test_incremental_add_updates_only_active_index_corpus_revision(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from deeptutor.services.rag.pipelines.llamaindex import storage
    from deeptutor.services.rag.pipelines.llamaindex.pipeline import LlamaIndexPipeline

    active_sig = _signature()
    old_sig = EmbeddingSignature(
        binding="openai",
        model="embed-old",
        dimension=1024,
        base_url="https://example.test/v1",
        api_version="",
    )
    kb_dir = tmp_path / "kb"
    for number, signature in ((1, active_sig), (2, old_sig)):
        version_dir = kb_dir / f"version-{number}"
        version_dir.mkdir(parents=True)
        (version_dir / "docstore.json").write_text("{}", encoding="utf-8")
        write_version_meta(kb_dir, signature, storage_dir=version_dir)

    class _Loader:
        last_load_summary = {"indexed_file_count": 1}

        async def load(self, _file_paths):
            return [object()]

    monkeypatch.setattr(LlamaIndexPipeline, "_configure_settings", lambda self: None)
    monkeypatch.setattr(LlamaIndexPipeline, "_verify_embedding_connectivity", lambda self: _completed())
    monkeypatch.setattr(storage, "insert_documents", lambda *_args, **_kwargs: 1)
    pipeline = LlamaIndexPipeline(
        kb_base_dir=str(tmp_path),
        signature_provider=lambda: active_sig,
        document_loader=_Loader(),
    )

    assert await pipeline.add_documents("kb", ["new.txt"]) is True

    assert find_matching_version(kb_dir, active_sig) is not None
    assert find_matching_version(kb_dir, old_sig) is None
    versions = {entry["version"]: entry for entry in list_kb_versions(kb_dir)}
    assert versions["version-1"]["corpus_current"] is True
    assert versions["version-2"]["corpus_current"] is False


@pytest.mark.asyncio
async def test_delete_keeps_failed_index_version_stale(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from deeptutor.services.rag.pipelines.llamaindex import storage
    from deeptutor.services.rag.pipelines.llamaindex.pipeline import LlamaIndexPipeline

    kb_dir = tmp_path / "kb"
    sig = _signature()
    for number in (1, 2):
        version_dir = kb_dir / f"version-{number}"
        version_dir.mkdir(parents=True)
        (version_dir / "docstore.json").write_text("{}", encoding="utf-8")
        write_version_meta(kb_dir, sig, storage_dir=version_dir)

    def _remove(storage_dir: Path, _file_path: str) -> int:
        if storage_dir.name == "version-2":
            raise RuntimeError("broken store")
        return 1

    monkeypatch.setattr(LlamaIndexPipeline, "_configure_settings", lambda self: None)
    monkeypatch.setattr(storage, "remove_document_nodes", _remove)
    pipeline = LlamaIndexPipeline(kb_base_dir=str(tmp_path), signature_provider=lambda: sig)
    revision = advance_corpus_revision(kb_dir)

    result = await pipeline.remove_document(
        "kb", "old.txt", corpus_revision=revision
    )

    assert result["versions_synchronized"] == 1
    assert len(result["errors"]) == 1
    versions = {entry["version"]: entry for entry in list_kb_versions(kb_dir)}
    assert versions["version-1"]["corpus_current"] is True
    assert versions["version-2"]["corpus_current"] is False
