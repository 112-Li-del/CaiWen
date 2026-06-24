"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FileText,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { invalidateClientCache } from "@/lib/client-cache";
import {
  deleteKnowledgeBaseFile,
  listKnowledgeBaseFiles,
  type KnowledgeBaseFile,
} from "@/lib/knowledge-api";
import { docIconFor, formatBytes } from "@/lib/doc-attachments";

interface KbDocumentListProps {
  kbName: string;
  /** Refresh trigger: bumping this prop forces a re-fetch (e.g. after upload). */
  refreshKey?: number;
  selectedFile: string | null;
  onSelect: (file: KnowledgeBaseFile) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export default function KbDocumentList({
  kbName,
  refreshKey = 0,
  selectedFile,
  onSelect,
  collapsed,
  onToggleCollapsed,
}: KbDocumentListProps) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<KnowledgeBaseFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      setError(null);
      try {
        if (force) {
          invalidateClientCache(`knowledge:files:${kbName}`);
        }
        const next = await listKnowledgeBaseFiles(kbName, { force });
        setFiles(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [kbName],
  );

  const handleDelete = useCallback(
    async (filename: string) => {
      if (!window.confirm(t("Are you sure you want to delete this document? This action cannot be undone."))) {
        return;
      }
      setDeleting(filename);
      try {
        await deleteKnowledgeBaseFile(kbName, filename);
        await load(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setDeleting(null);
      }
    },
    [kbName, load, t],
  );

  useEffect(() => {
    void load(refreshKey > 0);
  }, [load, refreshKey]);

  if (collapsed) {
    return (
      <aside className="flex h-full w-[44px] shrink-0 flex-col items-center gap-1 border-r border-[var(--border)] bg-[var(--card)]/40 py-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          title={t("Expand")}
          aria-label={t("Expand")}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <PanelLeftOpen size={13} strokeWidth={1.7} />
        </button>
        <button
          type="button"
          onClick={() => void load(true)}
          title={t("Refresh")}
          aria-label={t("Refresh")}
          disabled={loading}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
        </button>

        <div className="my-1 h-px w-6 bg-[var(--border)]/60" />

        <div className="flex w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto pb-2">
          {files.map((file) => {
            const spec = docIconFor(file.name);
            const Icon = spec.Icon;
            const active = selectedFile === file.name;
            const isDeleting = deleting === file.name;
            return (
              <div key={file.name} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(file)}
                  title={file.name}
                  aria-label={file.name}
                  className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${
                    active
                      ? "bg-[var(--primary)]/12 ring-1 ring-[var(--primary)]/40"
                      : "hover:bg-[var(--muted)]/60"
                  }`}
                >
                  {active && (
                    <span className="absolute -left-1 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-full bg-[var(--primary)]" />
                  )}
                  <Icon size={13} strokeWidth={1.6} className={spec.tint} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDelete(file.name);
                  }}
                  disabled={isDeleting}
                  title={t("Delete document")}
                  aria-label={t("Delete {{name}}", { name: file.name })}
                  className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--card)] text-[var(--muted-foreground)] opacity-0 shadow-sm transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 disabled:opacity-30"
                >
                  {isDeleting ? (
                    <Loader2 size={9} strokeWidth={2} className="animate-spin" />
                  ) : (
                    <Trash2 size={9} strokeWidth={2} />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--card)]/40">
      <div className="flex items-center justify-between gap-1 px-2.5 pb-1.5 pt-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-[12px] font-medium text-[var(--foreground)]">
            {t("Files")}
          </span>
          <span className="rounded-full bg-[var(--muted)] px-1.5 py-0 text-[10px] text-[var(--muted-foreground)]">
            {files.length}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => void load(true)}
            title={t("Refresh")}
            aria-label={t("Refresh")}
            disabled={loading}
            className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            title={t("Collapse")}
            aria-label={t("Collapse")}
            className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <PanelLeftClose size={12} strokeWidth={1.7} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 pb-2.5">
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
            <button
              type="button"
              onClick={() => void load(true)}
              className="ml-1 underline"
            >
              {t("Retry")}
            </button>
          </div>
        ) : loading && !files.length ? (
          <div className="space-y-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-8 rounded-md bg-[var(--muted)]/40 animate-pulse"
              />
            ))}
          </div>
        ) : files.length === 0 ? (
          <div className="px-2 py-6 text-center text-[11px] text-[var(--muted-foreground)]">
            <FileText className="mx-auto mb-1.5 h-3.5 w-3.5 opacity-50" />
            {t("No files yet. Add one using the Add Documents tab.")}
          </div>
        ) : (
          <ul className="space-y-px">
            {files.map((file) => {
              const spec = docIconFor(file.name);
              const Icon = spec.Icon;
              const active = selectedFile === file.name;
              const isDeleting = deleting === file.name;
              return (
                <li key={file.name} className="group">
                  <div
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                      active
                        ? "bg-[var(--primary)]/10 text-[var(--foreground)]"
                        : "hover:bg-[var(--muted)]/50"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(file)}
                      title={file.name}
                      className="flex min-w-0 flex-1 items-center gap-2"
                    >
                      <Icon
                        size={13}
                        strokeWidth={1.6}
                        className={`shrink-0 ${spec.tint}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-[var(--foreground)]">
                          {file.name}
                        </div>
                        <div className="truncate text-[10px] text-[var(--muted-foreground)]">
                          {formatBytes(file.size)}
                          {file.modified
                            ? ` · ${formatRelative(file.modified)}`
                            : ""}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(file.name);
                      }}
                      disabled={isDeleting}
                      title={t("Delete document")}
                      aria-label={t("Delete {{name}}", { name: file.name })}
                      className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 disabled:opacity-30"
                    >
                      {isDeleting ? (
                        <Loader2 size={13} strokeWidth={1.6} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} strokeWidth={1.6} />
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

function formatRelative(unixSeconds: number): string {
  const ts = unixSeconds * 1000;
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 24 * 60 * 60_000)
    return `${Math.floor(diff / (60 * 60_000))}h ago`;
  if (diff < 30 * 24 * 60 * 60_000)
    return `${Math.floor(diff / (24 * 60 * 60_000))}d ago`;
  return new Date(ts).toLocaleDateString();
}
