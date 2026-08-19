"""Canonical preview renditions for knowledge-base documents.

DOCX files are retained untouched in ``raw/``.  A content-addressed PDF is
created in ``raw/renditions/`` and is used for both indexing and preview, so a
reported page number always refers to the exact PDF shown to the user.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile
import threading
from typing import Any

import pymupdf

MANIFEST_SCHEMA_VERSION = 1
MANIFEST_FILENAME = "manifest.json"
DEFAULT_CONVERSION_TIMEOUT_SECONDS = 120
_MANIFEST_LOCK = threading.RLock()


class DocumentConversionError(RuntimeError):
    """Raised when a source document cannot produce a safe preview PDF."""


@dataclass(frozen=True)
class Rendition:
    original_path: Path
    pdf_path: Path
    preview_path: str
    original_sha256: str
    preview_sha256: str
    page_count: int
    converted_from_docx: bool


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def pdf_page_count(path: Path) -> int:
    try:
        with pymupdf.open(path) as document:
            count = int(document.page_count)
    except Exception as exc:
        raise DocumentConversionError(f"Invalid preview PDF '{path.name}': {exc}") from exc
    if count <= 0:
        raise DocumentConversionError(f"Preview PDF '{path.name}' has no pages")
    return count


class RenditionManager:
    """Create, cache and remove content-addressed DOCX preview PDFs."""

    def __init__(self, raw_dir: Path):
        self.raw_dir = Path(raw_dir)
        self.renditions_dir = self.raw_dir / "renditions"
        self.manifest_path = self.renditions_dir / MANIFEST_FILENAME

    def ensure_pdf(self, original_path: Path) -> Rendition:
        original = Path(original_path)
        if original.suffix.lower() == ".pdf":
            original_hash = sha256_file(original)
            return Rendition(
                original_path=original,
                pdf_path=original,
                preview_path=original.name,
                original_sha256=original_hash,
                preview_sha256=original_hash,
                page_count=pdf_page_count(original),
                converted_from_docx=False,
            )
        if original.suffix.lower() != ".docx":
            raise DocumentConversionError(f"No PDF rendition rule exists for '{original.name}'")

        mode = os.getenv("DOC_CONVERTER_MODE", "local").strip().lower()
        if mode == "none":
            raise DocumentConversionError(
                "DOCX indexing is disabled because DOC_CONVERTER_MODE=none"
            )
        if mode != "local":
            raise DocumentConversionError(
                f"Unsupported DOC_CONVERTER_MODE='{mode}'. Use local or none."
            )

        original_hash = sha256_file(original)
        self.renditions_dir.mkdir(parents=True, exist_ok=True)
        target = self.renditions_dir / f"{original_hash}.pdf"
        preview_path = f"renditions/{target.name}"

        with _MANIFEST_LOCK:
            manifest = self._read_manifest()
            cached = manifest["documents"].get(original.name)
            if (
                isinstance(cached, dict)
                and cached.get("status") == "ready"
                and cached.get("original_sha256") == original_hash
                and cached.get("preview_file") == target.name
                and target.is_file()
            ):
                try:
                    preview_hash = sha256_file(target)
                    if preview_hash == cached.get("preview_sha256"):
                        return Rendition(
                            original_path=original,
                            pdf_path=target,
                            preview_path=preview_path,
                            original_sha256=original_hash,
                            preview_sha256=preview_hash,
                            page_count=pdf_page_count(target),
                            converted_from_docx=True,
                        )
                except DocumentConversionError:
                    pass

            manifest["documents"][original.name] = {
                "status": "converting",
                "original_sha256": original_hash,
                "preview_file": target.name,
                "updated_at": self._now(),
            }
            self._write_manifest(manifest)

        converted_pdf: Path | None = None
        try:
            executable = self._find_libreoffice()
            version = self._libreoffice_version(executable)
            converted_pdf = self._convert_docx(executable, original)
            page_count = pdf_page_count(converted_pdf)
            preview_hash = sha256_file(converted_pdf)
            os.replace(converted_pdf, target)
        except Exception as exc:
            message = str(exc)
            with _MANIFEST_LOCK:
                manifest = self._read_manifest()
                manifest["documents"][original.name] = {
                    "status": "failed",
                    "original_sha256": original_hash,
                    "preview_file": target.name,
                    "error": message,
                    "updated_at": self._now(),
                }
                self._write_manifest(manifest)
            if isinstance(exc, DocumentConversionError):
                raise
            raise DocumentConversionError(message) from exc
        finally:
            if converted_pdf is not None:
                converted_pdf.unlink(missing_ok=True)

        with _MANIFEST_LOCK:
            manifest = self._read_manifest()
            manifest["documents"][original.name] = {
                "status": "ready",
                "original_sha256": original_hash,
                "preview_file": target.name,
                "preview_sha256": preview_hash,
                "converter": "LibreOffice",
                "converter_version": version,
                "font_environment": os.getenv(
                    "DOC_FONT_ENV_VERSION", f"local-unpinned:{platform.platform()}"
                ),
                "page_count": page_count,
                "updated_at": self._now(),
            }
            self._write_manifest(manifest)

        return Rendition(
            original_path=original,
            pdf_path=target,
            preview_path=preview_path,
            original_sha256=original_hash,
            preview_sha256=preview_hash,
            page_count=page_count,
            converted_from_docx=True,
        )

    def entry_for(self, original_name: str) -> dict[str, Any] | None:
        with _MANIFEST_LOCK:
            entry = self._read_manifest()["documents"].get(original_name)
            return dict(entry) if isinstance(entry, dict) else None

    def record_index_inspection(
        self,
        original_name: str,
        *,
        page_count: int,
        text_page_count: int,
        image_page_count: int,
    ) -> None:
        """Persist per-source indexing diagnostics without replacing rendition data."""
        if text_page_count == 0 and page_count > 0:
            indexing_status = "image_only"
        elif text_page_count > 0 and image_page_count > 0:
            indexing_status = "partial_images"
        else:
            indexing_status = "text_only"

        with _MANIFEST_LOCK:
            manifest = self._read_manifest()
            existing = manifest["documents"].get(original_name)
            entry = dict(existing) if isinstance(existing, dict) else {}
            entry.update(
                {
                    "indexing_status": indexing_status,
                    "page_count": page_count,
                    "text_page_count": text_page_count,
                    "image_page_count": image_page_count,
                    "indexing_inspected_at": self._now(),
                }
            )
            manifest["documents"][original_name] = entry
            self._write_manifest(manifest)

    def inspect_pdf_for_indexing(self, original_name: str, pdf_path: Path) -> dict[str, Any]:
        """Inspect a PDF once so existing documents can expose indexing warnings."""
        page_count = 0
        text_page_count = 0
        image_page_count = 0
        try:
            with pymupdf.open(pdf_path) as document:
                page_count = int(document.page_count)
                for page in document:
                    if page.get_text("text").strip():
                        text_page_count += 1
                    if page.get_images(full=True):
                        image_page_count += 1
        except Exception as exc:
            raise DocumentConversionError(
                f"Cannot inspect PDF '{Path(pdf_path).name}': {exc}"
            ) from exc

        self.record_index_inspection(
            original_name,
            page_count=page_count,
            text_page_count=text_page_count,
            image_page_count=image_page_count,
        )
        return self.entry_for(original_name) or {}

    def remove_for(self, original_name: str) -> None:
        """Remove one manifest entry and its unreferenced rendition PDF."""
        with _MANIFEST_LOCK:
            manifest = self._read_manifest()
            entry = manifest["documents"].pop(original_name, None)
            if not isinstance(entry, dict):
                return
            preview_file = str(entry.get("preview_file") or "")
            still_referenced = any(
                isinstance(other, dict) and other.get("preview_file") == preview_file
                for other in manifest["documents"].values()
            )
            if preview_file and not still_referenced:
                candidate = (self.renditions_dir / preview_file).resolve()
                try:
                    candidate.relative_to(self.renditions_dir.resolve())
                except ValueError:
                    candidate = None
                if candidate is not None and candidate.is_file():
                    candidate.unlink()
            self._write_manifest(manifest)

    def _read_manifest(self) -> dict[str, Any]:
        if not self.manifest_path.is_file():
            return {"schema_version": MANIFEST_SCHEMA_VERSION, "documents": {}}
        try:
            with open(self.manifest_path, encoding="utf-8") as handle:
                payload = json.load(handle)
            documents = payload.get("documents") if isinstance(payload, dict) else None
            if not isinstance(documents, dict):
                raise ValueError("documents must be an object")
            return {"schema_version": MANIFEST_SCHEMA_VERSION, "documents": documents}
        except Exception as exc:
            raise DocumentConversionError(
                f"Cannot read rendition manifest '{self.manifest_path}': {exc}"
            ) from exc

    def _write_manifest(self, payload: dict[str, Any]) -> None:
        self.renditions_dir.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(
            prefix=".manifest-", suffix=".json.tmp", dir=self.renditions_dir
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2, ensure_ascii=False)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_name, self.manifest_path)
        finally:
            try:
                Path(temp_name).unlink(missing_ok=True)
            except OSError:
                pass

    def _find_libreoffice(self) -> Path:
        configured = os.getenv("LIBREOFFICE_PATH", "").strip()
        candidates: list[Path] = []
        if configured:
            candidates.append(Path(configured).expanduser())
        for command in ("soffice.com", "soffice", "libreoffice"):
            discovered = shutil.which(command)
            if discovered:
                candidates.append(Path(discovered))
        candidates.extend(
            [
                Path(r"C:\Program Files\LibreOffice\program\soffice.com"),
                Path(r"C:\Program Files\LibreOffice\program\soffice.exe"),
                Path(r"C:\Program Files (x86)\LibreOffice\program\soffice.com"),
                Path("/usr/bin/libreoffice"),
                Path("/usr/bin/soffice"),
            ]
        )
        for candidate in candidates:
            if candidate.is_file():
                if candidate.name.lower() == "soffice.exe":
                    console_binary = candidate.with_name("soffice.com")
                    if console_binary.is_file():
                        return console_binary
                return candidate
        raise DocumentConversionError(
            "LibreOffice was not found. Set LIBREOFFICE_PATH to soffice.com/soffice."
        )

    def _libreoffice_version(self, executable: Path) -> str:
        try:
            completed = subprocess.run(
                [str(executable), "--headless", "--version"],
                check=True,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=15,
            )
            return (completed.stdout or completed.stderr).strip() or "unknown"
        except Exception:
            return "unknown"

    def _convert_docx(self, executable: Path, original: Path) -> Path:
        timeout = int(
            os.getenv(
                "DOC_CONVERSION_TIMEOUT_SECONDS",
                str(DEFAULT_CONVERSION_TIMEOUT_SECONDS),
            )
        )
        with tempfile.TemporaryDirectory(prefix="caiwen-lo-") as temp_root:
            root = Path(temp_root)
            output_dir = root / "output"
            profile_dir = root / "profile"
            output_dir.mkdir()
            profile_dir.mkdir()
            command = [
                str(executable),
                "--headless",
                "--nologo",
                "--nodefault",
                "--nofirststartwizard",
                f"-env:UserInstallation={profile_dir.resolve().as_uri()}",
                "--convert-to",
                "pdf:writer_pdf_Export",
                "--outdir",
                str(output_dir),
                str(original.resolve()),
            ]
            try:
                completed = subprocess.run(
                    command,
                    check=False,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=timeout,
                )
            except subprocess.TimeoutExpired as exc:
                raise DocumentConversionError(
                    f"LibreOffice conversion timed out after {timeout} seconds"
                ) from exc
            if completed.returncode != 0:
                detail = (completed.stderr or completed.stdout).strip()
                raise DocumentConversionError(
                    f"LibreOffice conversion failed ({completed.returncode}): {detail}"
                )
            result = output_dir / f"{original.stem}.pdf"
            if not result.is_file():
                detail = (completed.stdout or completed.stderr).strip()
                raise DocumentConversionError(
                    f"LibreOffice did not create the expected PDF: {detail}"
                )
            fd, pending_name = tempfile.mkstemp(
                prefix=".rendition-", suffix=".pending.pdf", dir=self.renditions_dir
            )
            os.close(fd)
            pending = Path(pending_name)
            shutil.copy2(result, pending)
            return pending

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()
