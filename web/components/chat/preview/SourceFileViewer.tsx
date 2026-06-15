"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Globe,
  Loader2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiUrl } from "@/lib/api";

// ── types ───────────────────────────────────────────────────────────

export interface SourceViewerSource {
  type: string; // "rag" | "web" | "paper"
  /** Display title */
  title?: string;
  /** Content preview (first 200 chars) */
  content_preview?: string;
  /** Full chunk text — the exact passage used for grounding */
  full_text?: string;
  /** Server-side file path (absolute) */
  source_file?: string;
  /** Page number (for PDFs) */
  page?: number | string;
  /** Relevance score */
  score?: number | string;
  /** Knowledge base name */
  kb_name?: string;
  /** Chunk/node ID from the index */
  chunk_id?: string;
  /** URL (web sources) */
  url?: string;
  query?: string;
}

interface SourceFileViewerProps {
  open: boolean;
  source: SourceViewerSource | null;
  onClose: () => void;
}

// ── helpers ─────────────────────────────────────────────────────────

/** Extract a clean display filename from an absolute path. */
function basename(path: string): string {
  if (!path) return "unknown";
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

/** Text-friendly MIME types for which line-numbered display makes sense. */
const TEXT_LIKE_EXTS = new Set([
  ".py", ".js", ".ts", ".tsx", ".jsx", ".vue", ".svelte",
  ".rs", ".go", ".java", ".c", ".cpp", ".h", ".hpp",
  ".rb", ".php", ".swift", ".kt", ".scala", ".clj",
  ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat",
  ".sql", ".r", ".m", ".jl", ".lua", ".ex", ".exs",
  ".erl", ".hrl", ".hs", ".elm", ".fs", ".fsx",
  ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
  ".md", ".mdx", ".rst", ".tex", ".sty", ".cls",
  ".css", ".scss", ".sass", ".less", ".svg",
  ".html", ".htm", ".xhtml",
  ".env", ".gitignore", ".dockerignore",
  ".proto", ".graphql", ".gql",
  ".cmake", ".make", ".mk", ".gradle", ".sbt",
  ".zig", ".nim", ".v", ".cr",
  ".csv", ".tsv", ".log", ".txt", ".text",
]);

function isTextLike(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return TEXT_LIKE_EXTS.has(ext);
}

// ── line data from API ──────────────────────────────────────────────

interface LineEntry {
  number: number;
  text: string;
  highlighted: boolean;
}

interface FileContentData {
  lines: LineEntry[];
  total_lines: number;
  first_highlighted_line: number | null;
  mime_type: string;
}

// ── component ───────────────────────────────────────────────────────

/**
 * Slide-over panel that displays the source file for a citation.
 *
 * - For **RAG** sources: fetches the raw file from the KB API, highlights
 *   the cited passage, and auto-scrolls to it.
 * - For **web** sources: renders the URL as an external link.
 * - Falls back to inline chunk text when the file can't be fetched.
 */
const SourceFileViewer = memo(function SourceFileViewer({
  open,
  source,
  onClose,
}: SourceFileViewerProps) {
  const { t } = useTranslation();
  const [fileState, setFileState] = useState<{
    kind: "idle" | "loading" | "ready" | "error";
    data?: FileContentData;
    message?: string;
  }>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const highlightedRef = useRef<HTMLDivElement | null>(null);
  const reqIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Derive display fields from source
  const displayName = useMemo(() => {
    if (!source) return "";
    if (source.type === "web") return source.title || source.url || "";
    return basename(source.source_file || "") || source.title || "";
  }, [source]);

  const pageLabel = useMemo(() => {
    if (!source || source.page === "" || source.page === undefined) return null;
    const p = Number(source.page);
    return Number.isNaN(p) ? null : p;
  }, [source]);

  const fileExt = useMemo(() => {
    const name = displayName;
    const dot = name.lastIndexOf(".");
    return dot >= 0 ? name.slice(dot).toLowerCase() : "";
  }, [displayName]);

  const canFetchFile = useMemo(() => {
    if (!source) return false;
    if (source.type === "web") return false;
    if (!source.kb_name) return false;
    const fn = basename(source.source_file || "");
    if (!fn) return false;
    return isTextLike(fn);
  }, [source]);

  // Fetch file content when the panel opens for a RAG source
  useEffect(() => {
    if (!open || !source || source.type === "web" || !canFetchFile) {
      setFileState({ kind: "idle" });
      return;
    }

    const fn = basename(source.source_file || "");
    const highlight = source.full_text || source.content_preview || "";
    const kbName = source.kb_name || "";

    const reqId = ++reqIdRef.current;
    setFileState({ kind: "loading" });

    const controller = new AbortController();
    const url = apiUrl(
      `/api/v1/kb/${encodeURIComponent(kbName)}/files/${encodeURIComponent(fn)}/content?highlight=${encodeURIComponent(highlight.slice(0, 500))}`,
    );

    (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as FileContentData;
        if (reqIdRef.current !== reqId) return;
        setFileState({ kind: "ready", data });
      } catch (err) {
        if (controller.signal.aborted) return;
        if (reqIdRef.current !== reqId) return;
        const msg =
          err instanceof Error ? err.message : "Failed to load file content";
        setFileState({ kind: "error", message: msg });
      }
    })();

    return () => {
      controller.abort();
    };
  }, [open, source, canFetchFile]);

  // Auto-scroll to the first highlighted line once the content is ready
  useEffect(() => {
    if (
      fileState.kind === "ready" &&
      fileState.data?.first_highlighted_line &&
      highlightedRef.current &&
      scrollRef.current
    ) {
      // Small delay to let the DOM settle after render
      const timer = setTimeout(() => {
        highlightedRef.current?.scrollIntoView({
          block: "center",
          behavior: "smooth",
        });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [fileState]);

  // ── close + reset ──────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    setFileState({ kind: "idle" });
    onClose();
  }, [onClose]);

  const handleCopyChunk = useCallback(() => {
    const text = source?.full_text || source?.content_preview || "";
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [source]);

  // ── build highlighted line number set ──────────────────────────────

  const highlightedLines = useMemo(() => {
    if (fileState.kind !== "ready" || !fileState.data) return new Set<number>();
    return new Set(
      fileState.data.lines
        .filter((l) => l.highlighted)
        .map((l) => l.number),
    );
  }, [fileState]);

  // ── render ─────────────────────────────────────────────────────────

  if (!open || !source) return null;

  return (
    <>
      {/* Backdrop — subtle, lets you still see the chat behind */}
      <div
        className="fixed inset-0 z-40 bg-black/20 transition-opacity duration-200"
        onClick={handleClose}
      />

      {/* Slide-over panel */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-[min(560px,90vw)] flex-col border-l border-[var(--border)] bg-[var(--background)] shadow-2xl transition-transform duration-300">
        {/* ── Header ──────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {source.type === "web" ? (
              <Globe size={16} className="shrink-0 text-[var(--muted-foreground)]" />
            ) : (
              <FileText size={16} className="shrink-0 text-[var(--muted-foreground)]" />
            )}
            <h3 className="truncate text-[13px] font-semibold text-[var(--foreground)]">
              {source.type === "web"
                ? t("Web Source")
                : t("Source: ") + displayName}
            </h3>
          </div>
          <button
            onClick={handleClose}
            className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            aria-label={t("Close")}
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Metadata bar ──────────────────────────────────────── */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--border)] px-4 py-2 text-[11px] text-[var(--muted-foreground)]">
          {source.kb_name && (
            <span className="inline-flex items-center gap-1">
              <span className="font-medium text-[var(--foreground)]/70">
                {t("KB")}:
              </span>{" "}
              {source.kb_name}
            </span>
          )}
          {pageLabel !== null && (
            <span className="inline-flex items-center gap-1">
              <span className="font-medium text-[var(--foreground)]/70">
                {t("Page")}:
              </span>{" "}
              {pageLabel}
            </span>
          )}
          {source.score && Number(source.score) > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="font-medium text-[var(--foreground)]/70">
                {t("Relevance")}:
              </span>{" "}
              {(Number(source.score) * 100).toFixed(0)}%
            </span>
          )}
          {source.title && displayName !== source.title && (
            <span className="truncate">{source.title}</span>
          )}
        </div>

        {/* ── Body ──────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto" ref={scrollRef}>
          {source.type === "web" ? (
            /* ── Web source ──────────────────────────────────────── */
            <div className="p-4">
              <div className="mb-3 text-[12px] text-[var(--muted-foreground)]">
                {t(
                  "This citation is from a web search result. Click below to open the original page.",
                )}
              </div>
              <a
                href={source.url || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-[13px] font-medium text-[var(--primary)] transition-colors hover:bg-[var(--muted)]"
              >
                {source.title || source.url}
                <ArrowUpRight size={13} />
              </a>
              {(source.content_preview || source.full_text) && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-[12px] font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                    <ChevronDown
                      size={12}
                      className="mr-1 inline transition-transform group-open:rotate-180"
                    />
                    {t("Content preview")}
                  </summary>
                  <div className="mt-2 whitespace-pre-wrap rounded-md bg-[var(--muted)]/60 p-3 text-[12px] leading-relaxed text-[var(--foreground)]/80">
                    {source.full_text || source.content_preview}
                  </div>
                </details>
              )}
            </div>
          ) : fileState.kind === "loading" ? (
            /* ── Loading ──────────────────────────────────────────── */
            <div className="flex h-full items-center justify-center gap-2 text-[12px] text-[var(--muted-foreground)]">
              <Loader2 size={14} className="animate-spin" />
              <span>{t("Loading source file…")}</span>
            </div>
          ) : fileState.kind === "ready" && fileState.data ? (
            /* ── File content with line numbers ────────────────────── */
            <div className="py-2">
              {/* Chunk text preview card */}
              {(source.full_text || source.content_preview) && (
                <details className="mx-4 mb-3" open>
                  <summary className="cursor-pointer text-[11px] font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                    <ChevronDown
                      size={11}
                      className="mr-1 inline transition-transform group-open:rotate-180"
                    />
                    {t("Cited passage")}
                  </summary>
                  <div className="mt-1.5 whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--card)] p-2.5 text-[12px] leading-relaxed text-[var(--foreground)]">
                    {source.full_text || source.content_preview}
                    <button
                      onClick={handleCopyChunk}
                      className="ml-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                      aria-label={t("Copy")}
                    >
                      {copied ? (
                        <Check size={11} />
                      ) : (
                        <Copy size={11} />
                      )}
                    </button>
                  </div>
                </details>
              )}

              {/* Full file — line-numbered view */}
              <div className="border-t border-[var(--border)] pt-2">
                <div className="mb-1 px-4 text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  {t("Full file")} ({fileState.data.total_lines.toLocaleString()}{" "}
                  {t("lines")})
                </div>
                <div className="font-mono text-[12px] leading-[1.55]">
                  {fileState.data.lines.map((line) => (
                    <div
                      key={line.number}
                      ref={line.highlighted ? highlightedRef : undefined}
                      className={`flex ${
                        line.highlighted
                          ? "bg-[var(--primary)]/10 border-l-[3px] border-[var(--primary)]"
                          : "border-l-[3px] border-transparent hover:bg-[var(--muted)]/30"
                      }`}
                    >
                      <span className="select-none shrink-0 w-[3.25rem] text-right pr-3 text-[var(--muted-foreground)]/50">
                        {line.number}
                      </span>
                      <span className="whitespace-pre flex-1 pr-4 text-[var(--foreground)]/85">
                        {line.text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : fileState.kind === "error" || !canFetchFile ? (
            /* ── Fallback: show chunk text only ────────────────────── */
            <div className="p-4">
              {fileState.kind === "error" && (
                <div className="mb-3 rounded-md border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
                  {t("Could not load the full source file.")}{" "}
                  {fileState.message && `(${fileState.message})`}
                </div>
              )}

              {(source.full_text || source.content_preview) ? (
                <>
                  <div className="mb-2 text-[11px] font-medium text-[var(--muted-foreground)]">
                    {t("Cited passage")}:
                  </div>
                  <div className="whitespace-pre-wrap rounded-md bg-[var(--muted)]/60 p-3 text-[12px] leading-relaxed text-[var(--foreground)]/80">
                    {source.full_text || source.content_preview}
                  </div>
                  <button
                    onClick={handleCopyChunk}
                    className="mt-2 inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    {copied ? (
                      <>
                        <Check size={11} /> {t("Copied")}
                      </>
                    ) : (
                      <>
                        <Copy size={11} /> {t("Copy passage")}
                      </>
                    )}
                  </button>
                </>
              ) : (
                <div className="text-[12px] text-[var(--muted-foreground)]">
                  {t("No content preview available for this source.")}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
});

SourceFileViewer.displayName = "SourceFileViewer";
export default SourceFileViewer;
