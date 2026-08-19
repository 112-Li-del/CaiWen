from __future__ import annotations

import json
from pathlib import Path

import pytest

from deeptutor.services.rag.index_versioning import EmbeddingSignature


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
