"""Document loading for the LlamaIndex RAG pipeline."""

from __future__ import annotations

import asyncio
import logging
import mimetypes
from pathlib import Path
from typing import Iterable

from llama_index.core import Document
import pymupdf

from deeptutor.knowledge.renditions import DocumentConversionError, RenditionManager
from deeptutor.services.rag.file_routing import FileTypeRouter
from deeptutor.utils.document_extractor import DocumentExtractionError, extract_text_from_path
from deeptutor.utils.document_validator import DocumentValidator


class ImageOnlyDocumentError(RuntimeError):
    """Raised when every usable source document has no extractable text."""


class LlamaIndexDocumentLoader:
    """Convert source files into LlamaIndex ``Document`` objects."""

    def __init__(self, logger=None) -> None:
        self.logger = logger or logging.getLogger(__name__)
        self.last_load_summary: dict[str, object] = {
            "total_file_count": 0,
            "indexed_file_count": 0,
            "image_only_file_count": 0,
            "skipped_file_count": 0,
            "indexed_files": [],
            "image_only_files": [],
            "skipped_files": [],
        }

    async def load(self, file_paths: Iterable[str]) -> list[Document]:
        requested_paths = list(file_paths)
        documents: list[Document] = []
        image_only_files: list[str] = []
        classification = FileTypeRouter.classify_files(requested_paths)

        for file_path_str in classification.parser_files:
            file_path = Path(file_path_str)
            self.logger.info(f"Parsing document: {file_path.name}")
            if file_path.suffix.lower() in {".pdf", ".docx"}:
                page_documents = await asyncio.to_thread(self._load_pdf_pages, file_path)
                documents.extend(page_documents)
                inspection = RenditionManager(file_path.parent).entry_for(file_path.name) or {}
                if inspection.get("indexing_status") == "image_only":
                    image_only_files.append(file_path.name)
                continue
            text = self._extract_parser_text(file_path)
            self._append_if_nonempty(documents, file_path, text)

        for file_path_str in classification.text_files:
            file_path = Path(file_path_str)
            self.logger.info(f"Parsing text: {file_path.name}")
            text = await FileTypeRouter.read_text_file(str(file_path))
            self._append_if_nonempty(documents, file_path, text)

        for file_path_str in classification.unsupported:
            self.logger.warning(f"Skipped unsupported file: {Path(file_path_str).name}")

        requested_files = {Path(path).name for path in requested_paths}
        indexed_files = {
            str(document.metadata.get("file_name") or "")
            for document in documents
            if document.metadata.get("file_name")
        }
        image_only_set = set(image_only_files)
        skipped_files = requested_files - indexed_files
        self.last_load_summary = {
            "total_file_count": len(requested_files),
            "indexed_file_count": len(indexed_files),
            "image_only_file_count": len(image_only_set),
            "skipped_file_count": len(skipped_files),
            "indexed_files": sorted(indexed_files),
            "image_only_files": sorted(image_only_set),
            "skipped_files": sorted(skipped_files),
        }

        if not documents and image_only_files:
            names = "、".join(image_only_files)
            raise ImageOnlyDocumentError(f"文档全是图片，无法建立索引：{names}")

        return documents

    def _load_pdf_pages(self, original_path: Path) -> list[Document]:
        try:
            rendition = RenditionManager(original_path.parent).ensure_pdf(original_path)
        except (DocumentConversionError, OSError) as exc:
            self.logger.error(f"Failed to prepare {original_path.name}: {exc}")
            return []

        documents: list[Document] = []
        image_page_count = 0
        text_page_count = 0
        try:
            with pymupdf.open(rendition.pdf_path) as pdf:
                for index, page in enumerate(pdf):
                    if page.get_images(full=True):
                        image_page_count += 1
                    text = page.get_text("text")
                    if not text.strip():
                        self.logger.warning(
                            f"Skipped empty/scanned page {index + 1} of {original_path.name}"
                        )
                        continue
                    text_page_count += 1
                    documents.append(
                        Document(
                            text=text,
                            metadata=self._metadata_for(
                                original_path,
                                preview_path=rendition.preview_path,
                                page_number=index + 1,
                                page_count=rendition.page_count,
                                converted_from_docx=rendition.converted_from_docx,
                            ),
                        )
                    )
        except Exception as exc:
            self.logger.error(f"Failed to read PDF pages for {original_path.name}: {exc}")
            return []

        RenditionManager(original_path.parent).record_index_inspection(
            original_path.name,
            page_count=rendition.page_count,
            text_page_count=text_page_count,
            image_page_count=image_page_count,
        )

        if documents:
            self.logger.info(
                f"Loaded: {original_path.name} ({len(documents)}/{rendition.page_count} text pages)"
            )
            if image_page_count:
                self.logger.warning(
                    f"该文档内含有图片，索引建立不完全：{original_path.name}"
                )
        else:
            self.logger.warning(f"文档全是图片，无法建立索引：{original_path.name}")
        return documents

    def _extract_parser_text(self, file_path: Path) -> str:
        max_bytes = (
            DocumentValidator.MAX_PDF_SIZE
            if file_path.suffix.lower() == ".pdf"
            else DocumentValidator.MAX_FILE_SIZE
        )
        try:
            return extract_text_from_path(file_path, max_bytes=max_bytes, max_chars=None)
        except (DocumentExtractionError, OSError) as exc:
            self.logger.error(f"Failed to extract {file_path.name}: {exc}")
            return ""

    def _append_if_nonempty(self, documents: list[Document], file_path: Path, text: str) -> None:
        if text.strip():
            documents.append(
                Document(
                    text=text,
                    metadata=self._metadata_for(file_path, preview_path=file_path.name),
                )
            )
            self.logger.info(f"Loaded: {file_path.name} ({len(text)} chars)")
        else:
            self.logger.warning(f"Skipped empty document: {file_path.name}")

    @staticmethod
    def _metadata_for(
        file_path: Path,
        *,
        preview_path: str,
        page_number: int | None = None,
        page_count: int | None = None,
        converted_from_docx: bool = False,
    ) -> dict[str, object]:
        metadata: dict[str, object] = {
            "file_name": file_path.name,
            "file_path": str(file_path),
            "raw_name": file_path.name,
            "preview_path": preview_path,
            "preview_mime": "application/pdf"
            if preview_path.lower().endswith(".pdf")
            else (mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"),
            "converted_from_docx": converted_from_docx,
        }
        if page_number is not None:
            metadata["page"] = page_number
            metadata["page_number"] = page_number
            metadata["page_label"] = str(page_number)
        if page_count is not None:
            metadata["page_count"] = page_count
        return metadata
