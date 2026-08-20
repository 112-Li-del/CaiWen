from __future__ import annotations

import json
from pathlib import Path

from deeptutor.knowledge.add_documents import remove_ingested_file_hash


def test_remove_ingested_file_hash_preserves_other_metadata(tmp_path: Path) -> None:
    kb_dir = tmp_path / "kb"
    kb_dir.mkdir()
    metadata_file = kb_dir / "metadata.json"
    metadata_file.write_text(
        json.dumps(
            {
                "corpus_revision": 3,
                "file_hashes": {"deleted.pdf": "aaa", "kept.pdf": "bbb"},
                "custom": "value",
            }
        ),
        encoding="utf-8",
    )

    assert remove_ingested_file_hash(kb_dir, "deleted.pdf") is True

    metadata = json.loads(metadata_file.read_text(encoding="utf-8"))
    assert metadata == {
        "corpus_revision": 3,
        "file_hashes": {"kept.pdf": "bbb"},
        "custom": "value",
    }
