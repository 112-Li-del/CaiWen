"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Loader2,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import { fetchAdminResources, fetchDefaultGrants, saveDefaultGrants } from "../api";
import type { DefaultGrantsConfig, MultiUserResources } from "../types";

type SaveState = "idle" | "saving" | "saved" | "error";

type Service = "llm" | "embedding" | "search";

function emptyConfig(): DefaultGrantsConfig {
  return {
    version: 1,
    models: { llm: [], embedding: [], search: [] },
    knowledge_bases: [],
  };
}

function hasModel(
  config: DefaultGrantsConfig,
  service: Service,
  profileId: string,
  modelId?: string,
) {
  return config.models[service].some((item) => {
    if (item.profile_id !== profileId) return false;
    if (!modelId) return true;
    return Array.isArray(item.model_ids) && item.model_ids.includes(modelId);
  });
}

function configFingerprint(config: DefaultGrantsConfig): string {
  return JSON.stringify(config);
}

export function DefaultGrantsEditor() {
  const { t } = useTranslation();
  const [resources, setResources] = useState<MultiUserResources | null>(null);
  const [config, setConfig] = useState<DefaultGrantsConfig>(() => emptyConfig());
  const [loading, setLoading] = useState(true);
  const [savedFingerprint, setSavedFingerprint] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [nextResources, nextConfig] = await Promise.all([
          fetchAdminResources(),
          fetchDefaultGrants(),
        ]);
        if (cancelled) return;
        setResources(nextResources);
        setConfig(nextConfig.config);
        setSavedFingerprint(configFingerprint(nextConfig.config));
      } catch (error) {
        if (cancelled) return;
        setSaveState("error");
        setMessage(
          error instanceof Error ? error.message : t("Failed to load default grants"),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const currentFingerprint = useMemo(() => configFingerprint(config), [config]);
  const dirty =
    Boolean(savedFingerprint) && currentFingerprint !== savedFingerprint;

  const kbIds = useMemo(
    () =>
      new Set(
        config.knowledge_bases.map((item) =>
          String(item.resource_id || item.id || ""),
        ),
      ),
    [config.knowledge_bases],
  );

  const selectedModelCount = useMemo(
    () =>
      (["llm", "embedding", "search"] as const).reduce(
        (total, service) =>
          total +
          config.models[service].reduce((serviceTotal, item) => {
            if (Array.isArray(item.model_ids))
              return serviceTotal + item.model_ids.length;
            return serviceTotal + 1;
          }, 0),
        0,
      ),
    [config.models],
  );

  const saving = saveState === "saving";
  const controlsDisabled = loading || saving;

  function toggleModel(
    service: Service,
    profileId: string,
    modelId?: string,
  ) {
    setConfig((current) => {
      const next = structuredClone(current) as DefaultGrantsConfig;
      const items = next.models[service];
      if (service === "search" || !modelId) {
        next.models[service] = hasModel(next, service, profileId)
          ? items.filter((item) => item.profile_id !== profileId)
          : [...items, { profile_id: profileId }];
        return next;
      }
      const existing = items.find((item) => item.profile_id === profileId);
      if (!existing) {
        items.push({ profile_id: profileId, model_ids: [modelId] });
        return next;
      }
      const modelIds = new Set(
        Array.isArray(existing.model_ids) ? existing.model_ids : [],
      );
      if (modelIds.has(modelId)) modelIds.delete(modelId);
      else modelIds.add(modelId);
      existing.model_ids = Array.from(modelIds);
      next.models[service] = items.filter((item) =>
        Array.isArray(item.model_ids) ? item.model_ids.length > 0 : true,
      );
      return next;
    });
  }

  function toggleKb(resourceId: string, name: string) {
    setConfig((current) => {
      const next = structuredClone(current) as DefaultGrantsConfig;
      const exists = kbIds.has(resourceId);
      next.knowledge_bases = exists
        ? next.knowledge_bases.filter(
            (item) => String(item.resource_id || item.id || "") !== resourceId,
          )
        : [
            ...next.knowledge_bases,
            { resource_id: resourceId, name, access: "read", source: "admin" },
          ];
      return next;
    });
  }

  async function save() {
    setSaveState("saving");
    setMessage("");
    try {
      const saved = await saveDefaultGrants(config);
      setConfig(saved.config);
      setSavedFingerprint(configFingerprint(saved.config));
      setSaveState("saved");
      setMessage(t("Saved just now"));
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : t("Failed to save"));
    }
  }

  const status = loading
    ? t("Loading default grants...")
    : saveState === "saving"
      ? t("Saving changes…")
      : saveState === "error"
        ? message || t("Failed to save")
        : saveState === "saved" && !dirty
          ? message || t("Saved just now")
          : dirty
            ? t("Unsaved changes")
            : t("Ready");

  const statusTone =
    saveState === "error"
      ? "text-red-600 dark:text-red-400"
      : saveState === "saved" && !dirty
        ? "text-emerald-700 dark:text-emerald-300"
        : "text-[var(--muted-foreground)]";

  if (loading && !resources) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] text-sm text-[var(--muted-foreground)]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t("Loading default grants...")}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
      <div className="flex h-[620px] max-h-[calc(100vh-170px)] min-h-[420px] flex-col overflow-hidden rounded-2xl">
        <div className="shrink-0 border-b border-[var(--border)] px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--foreground)]">
                {t("所有普通成员的默认权限")}
              </h2>
              <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                {t(
                  "统一应用于已有和新增的普通成员，学生与教师使用相同的默认资源权限。",
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px] text-[var(--muted-foreground)]">
              <span className="rounded-full bg-[var(--muted)]/60 px-2 py-1">
                {t("{{count}} models", { count: selectedModelCount })}
              </span>
              <span className="rounded-full bg-[var(--muted)]/60 px-2 py-1">
                {t("{{count}} KBs", { count: kbIds.size })}
              </span>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 [scrollbar-gutter:stable]">
          <div className="grid gap-5 md:grid-cols-3">
            <section className="min-w-0">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                {t("Models")}
              </h3>
              <div className="space-y-3 text-xs">
                {(["llm", "embedding"] as const).map((service) => (
                  <div key={service} className="space-y-1.5">
                    <div className="font-medium text-[var(--foreground)]">
                      {service.toUpperCase()}
                    </div>
                    {(resources?.models[service] || []).map((profile) => (
                      <div
                        key={profile.profile_id}
                        className="rounded-lg border border-[var(--border)]/60 p-2"
                      >
                        <div className="mb-1 truncate text-[var(--muted-foreground)]">
                          {profile.name}
                        </div>
                        {(profile.models || []).map((model) => (
                          <label
                            key={model.model_id}
                            className="flex cursor-pointer items-center gap-2 py-1 text-[var(--foreground)]"
                          >
                            <input
                              type="checkbox"
                              checked={hasModel(
                                config,
                                service,
                                profile.profile_id,
                                model.model_id,
                              )}
                              disabled={controlsDisabled}
                              onChange={() =>
                                toggleModel(
                                  service,
                                  profile.profile_id,
                                  model.model_id,
                                )
                              }
                            />
                            <span className="truncate">{model.name}</span>
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
                <div className="space-y-1.5">
                  <div className="font-medium text-[var(--foreground)]">
                    SEARCH
                  </div>
                  {(resources?.models.search || []).map((profile) => (
                    <label
                      key={profile.profile_id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)]/60 p-2 text-[var(--foreground)]"
                    >
                      <input
                        type="checkbox"
                        checked={hasModel(config, "search", profile.profile_id)}
                        disabled={controlsDisabled}
                        onChange={() =>
                          toggleModel("search", profile.profile_id)
                        }
                      />
                      <span className="truncate">{profile.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </section>
            <section className="min-w-0">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                {t("Knowledge")}
              </h3>
              <p className="mb-2 flex items-center gap-1.5 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
                <Database size={12} strokeWidth={1.6} />
                {t(
                  "勾选的公共知识库向所有普通成员开放只读访问。",
                )}
              </p>
              <div className="space-y-1.5 text-xs">
                {(resources?.knowledge_bases || []).map((kb) => (
                  <label
                    key={kb.resource_id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)]/60 p-2 text-[var(--foreground)]"
                  >
                    <input
                      type="checkbox"
                      checked={kbIds.has(kb.resource_id)}
                      disabled={controlsDisabled}
                      onChange={() => toggleKb(kb.resource_id, kb.name)}
                    />
                    <span className="truncate">{kb.name}</span>
                  </label>
                ))}
                {!resources?.knowledge_bases?.length && (
                  <p className="rounded-lg border border-dashed border-[var(--border)]/70 px-3 py-4 text-center text-[11px] text-[var(--muted-foreground)]">
                    {t("No knowledge bases available")}
                  </p>
                )}
              </div>
            </section>
            <section className="min-w-0">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                {t("How it works")}
              </h3>
              <div className="space-y-3 rounded-lg border border-[var(--border)]/60 p-3 text-xs leading-relaxed text-[var(--muted-foreground)]">
                <p className="flex items-start gap-2">
                  <SlidersHorizontal
                    size={14}
                    strokeWidth={1.6}
                    className="mt-0.5 shrink-0"
                  />
                  <span>
                    {t(
                      "保存后，已有和新增的普通成员统一使用勾选的模型与公共知识库；取消勾选也会统一生效。",
                    )}
                  </span>
                </p>
                <p className="flex items-start gap-2">
                  <CheckCircle2
                    size={14}
                    strokeWidth={1.6}
                    className="mt-0.5 shrink-0"
                  />
                  <span>
                    {t(
                      "Knowledge bases are granted read-only. Normal users still never see the knowledge page in the sidebar.",
                    )}
                  </span>
                </p>
                <p className="flex items-start gap-2">
                  <Database
                    size={14}
                    strokeWidth={1.6}
                    className="mt-0.5 shrink-0"
                  />
                  <span>
                    {t(
                      "This configuration is stored per deployment and does not affect other instances.",
                    )}
                  </span>
                </p>
              </div>
            </section>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--card)] px-5 py-3">
          <div
            aria-live="polite"
            className={`flex min-w-0 items-center gap-1.5 text-xs ${statusTone}`}
          >
            {saveState === "error" ? (
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            ) : saveState === "saved" && !dirty ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            ) : null}
            <span className="truncate">{status}</span>
          </div>
          <button
            onClick={save}
            disabled={controlsDisabled || !dirty}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-xs font-medium text-[var(--background)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : saveState === "saved" && !dirty ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            {saving
              ? t("Saving…")
              : saveState === "saved" && !dirty
                ? t("Saved")
                : t("Save defaults")}
          </button>
        </div>
      </div>
    </div>
  );
}
