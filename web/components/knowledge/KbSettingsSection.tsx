"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, Pencil, Star, Trash2, X } from "lucide-react";
import {
  formatKnowledgeTimestamp,
  type KnowledgeBase,
} from "@/lib/knowledge-helpers";

interface KbSettingsSectionProps {
  kb: KnowledgeBase;
  onSetDefault: () => Promise<void>;
  onDelete: () => Promise<void>;
  onRename: (newName: string) => Promise<void>;
}

export default function KbSettingsSection({
  kb,
  onSetDefault,
  onDelete,
  onRename,
}: KbSettingsSectionProps) {
  const { t } = useTranslation();
  const meta = kb.metadata || {};
  const provider = kb.statistics?.rag_provider || "llamaindex";
  const embeddingLabel = meta.embedding_model
    ? typeof meta.embedding_dim === "number"
      ? `${meta.embedding_model} · ${meta.embedding_dim}${t("d")}`
      : meta.embedding_model
    : t("Default embedding");
  const created = formatKnowledgeTimestamp(meta.created_at);
  const updated = formatKnowledgeTimestamp(meta.last_updated);
  const lastIndexed = formatKnowledgeTimestamp(meta.last_indexed_at);

  // Rename state
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(kb.name);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const handleStartEdit = () => {
    setDraftName(kb.name);
    setRenameError(null);
    setEditingName(true);
  };

  const handleCancelEdit = () => {
    setEditingName(false);
    setDraftName(kb.name);
    setRenameError(null);
  };

  const handleSaveRename = async () => {
    const trimmed = draftName.trim();
    if (!trimmed) {
      setRenameError(t("Knowledge base name is required"));
      return;
    }
    if (trimmed === kb.name) {
      setEditingName(false);
      return;
    }
    setRenaming(true);
    setRenameError(null);
    try {
      await onRename(trimmed);
      setEditingName(false);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenaming(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Rename section */}
      <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
        <div>
          <div className="text-[12.5px] font-medium text-[var(--foreground)]">
            {t("Knowledge Base Name")}
          </div>
          <p className="mt-0.5 text-[11.5px] text-[var(--muted-foreground)]">
            {t("Rename this knowledge base.")}
          </p>
        </div>

        {editingName ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                disabled={renaming}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleSaveRename();
                  } else if (event.key === "Escape") {
                    handleCancelEdit();
                  }
                }}
                className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-[13px] text-[var(--foreground)] outline-none transition-colors focus:border-[var(--foreground)]/25 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void handleSaveRename()}
                disabled={renaming || !draftName.trim()}
                className="inline-flex items-center gap-1 rounded-md bg-[var(--primary)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {renaming ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
                {t("Save")}
              </button>
              <button
                type="button"
                onClick={handleCancelEdit}
                disabled={renaming}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] disabled:opacity-50"
              >
                <X className="h-3 w-3" />
                {t("Cancel")}
              </button>
            </div>
            {renameError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11.5px] text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                {renameError}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-[var(--foreground)]">
              {kb.name}
            </span>
            {!kb.read_only && (
              <button
                type="button"
                onClick={handleStartEdit}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              >
                <Pencil className="h-3 w-3" />
                {t("Edit")}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <div className="text-[13px] font-medium text-[var(--foreground)]">
            {t("Overview")}
          </div>
          <p className="mt-0.5 text-[11.5px] text-[var(--muted-foreground)]">
            {t("Read-only metadata. Use the actions below to manage this KB.")}
          </p>
        </div>

        <dl className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 sm:grid-cols-2">
          <Field label={t("RAG provider")}>{provider}</Field>
          <Field label={t("Embedding")}>{embeddingLabel}</Field>
          <Field label={t("Created")}>{created || "—"}</Field>
          <Field label={t("Updated")}>{updated || "—"}</Field>
          <Field label={t("Last indexed")}>{lastIndexed || "—"}</Field>
          {kb.path && (
            <Field label={t("On-disk path")} className="sm:col-span-2">
              <span className="font-mono text-[10.5px] text-[var(--muted-foreground)]">
                {kb.path}
              </span>
            </Field>
          )}
        </dl>
      </section>

      <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
        <div>
          <div className="text-[12.5px] font-medium text-[var(--foreground)]">
            {t("Default knowledge base")}
          </div>
          <p className="mt-0.5 text-[11.5px] text-[var(--muted-foreground)]">
            {t("The default KB is selected automatically in chat & TutorBot.")}
          </p>
        </div>
        {kb.is_default ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-100 px-2.5 py-1 text-[12px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
            <Star className="h-3 w-3" fill="currentColor" />
            {t("Currently default")}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void onSetDefault()}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1 text-[12px] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
          >
            <Star className="h-3 w-3" />
            {t("Set as default")}
          </button>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-red-200 bg-red-50/40 p-3 dark:border-red-900/60 dark:bg-red-950/15">
        <div>
          <div className="text-[12.5px] font-medium text-red-700 dark:text-red-300">
            {t("Danger zone")}
          </div>
          <p className="mt-0.5 text-[11.5px] text-red-700/80 dark:text-red-300/80">
            {t(
              "Deleting a knowledge base permanently removes its raw documents and index versions.",
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onDelete()}
          className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-[12px] font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
        >
          <Trash2 className="h-3 w-3" />
          {t("Delete knowledge base")}
        </button>
      </section>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[10.5px] uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
        {label}
      </dt>
      <dd className="mt-1 text-[12.5px] text-[var(--foreground)]">
        {children}
      </dd>
    </div>
  );
}
