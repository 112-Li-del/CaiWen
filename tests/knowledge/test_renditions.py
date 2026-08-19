from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pymupdf
import pytest

from deeptutor.knowledge.renditions import RenditionManager


def _write_pdf(path: Path, pages: list[str]) -> None:
    with pymupdf.open() as pdf:
        for text in pages:
            page = pdf.new_page()
            page.insert_text((72, 72), text)
        pdf.save(path)


def test_docx_rendition_is_content_addressed_cached_and_manifested(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    original = raw_dir / "student-handbook.docx"
    original.write_bytes(b"stable-docx-content")
    manager = RenditionManager(raw_dir)
    calls = 0

    monkeypatch.setattr(manager, "_find_libreoffice", lambda: Path("soffice.com"))
    monkeypatch.setattr(manager, "_libreoffice_version", lambda _executable: "test-version")

    def _fake_convert(_executable: Path, _original: Path) -> Path:
        nonlocal calls
        calls += 1
        pending = manager.renditions_dir / f"pending-{calls}.pdf"
        _write_pdf(pending, ["Page one", "Page two"])
        return pending

    monkeypatch.setattr(manager, "_convert_docx", _fake_convert)

    first = manager.ensure_pdf(original)
    second = manager.ensure_pdf(original)

    expected_hash = hashlib.sha256(original.read_bytes()).hexdigest()
    assert first.pdf_path == raw_dir / "renditions" / f"{expected_hash}.pdf"
    assert first.preview_path == f"renditions/{expected_hash}.pdf"
    assert first.page_count == 2
    assert second == first
    assert calls == 1

    manifest = json.loads(manager.manifest_path.read_text(encoding="utf-8"))
    entry = manifest["documents"][original.name]
    assert entry["status"] == "ready"
    assert entry["original_sha256"] == expected_hash
    assert entry["converter"] == "LibreOffice"
    assert entry["converter_version"] == "test-version"


def test_remove_for_deletes_unreferenced_preview(monkeypatch, tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    original = raw_dir / "rules.docx"
    original.write_bytes(b"rules")
    manager = RenditionManager(raw_dir)

    monkeypatch.setattr(manager, "_find_libreoffice", lambda: Path("soffice.com"))
    monkeypatch.setattr(manager, "_libreoffice_version", lambda _executable: "test-version")

    def _fake_convert(_executable: Path, _original: Path) -> Path:
        pending = manager.renditions_dir / "pending.pdf"
        _write_pdf(pending, ["Rules"])
        return pending

    monkeypatch.setattr(manager, "_convert_docx", _fake_convert)
    rendition = manager.ensure_pdf(original)

    manager.remove_for(original.name)

    assert not rendition.pdf_path.exists()
    assert manager.entry_for(original.name) is None
