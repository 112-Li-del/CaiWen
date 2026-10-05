"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import MarkdownRenderer from "@/components/common/MarkdownRenderer";
import LatticeLoader from "@/components/ui/LatticeLoader";
import type { StreamEvent } from "@/lib/unified-ws";

type TraceMetadata = {
  call_id?: string;
  phase?: string;
  label?: string;
  call_kind?: string;
  trace_role?: string;
  trace_group?: string;
  trace_kind?: string;
  trace_id?: string;
  call_state?: string;
  step_id?: string;
  round?: number;
  query?: string;
  tool_name?: string;
  trace_layer?: string;
  output_mode?: string;
  quality?: string;
  sources?: Array<Record<string, unknown>>;
};

type ResearchStageId = "understand" | "decompose" | "evidence" | "result";

type ResearchStageCard = {
  id: ResearchStageId;
  title: string;
  hint: string;
  events: StreamEvent[];
};

// `title` and `hint` are i18n keys resolved via `t(...)` at render time so the
// stage banner follows the active UI language instead of being locked to one.
const RESEARCH_STAGE_SPECS: Array<{
  id: ResearchStageId;
  titleKey: string;
  hintKey: string;
}> = [
  {
    id: "understand",
    titleKey: "research.stage.understand.title",
    hintKey: "research.stage.understand.hint",
  },
  {
    id: "decompose",
    titleKey: "research.stage.decompose.title",
    hintKey: "research.stage.decompose.hint",
  },
  {
    id: "evidence",
    titleKey: "research.stage.evidence.title",
    hintKey: "research.stage.evidence.hint",
  },
  {
    id: "result",
    titleKey: "research.stage.result.title",
    hintKey: "research.stage.result.hint",
  },
];

type TraceItem = { callId: string; events: StreamEvent[] };
type DisplayItem =
  | { kind: "trace"; trace: TraceItem }
  | { kind: "step"; stepId: string; traces: TraceItem[] };

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeQuestionId(
  value: string,
  t?: (key: string, opts?: Record<string, unknown>) => string,
) {
  return value.replace(/\bq_(\d+)\b/gi, (_match, n) =>
    t ? t("Question {{n}}", { n }) : `Question ${n}`,
  );
}

export function getTraceMeta(event: StreamEvent): TraceMetadata {
  return (event.metadata ?? {}) as TraceMetadata;
}

function getTraceLabel(
  events: StreamEvent[],
  t?: (key: string, opts?: Record<string, unknown>) => string,
) {
  for (const event of events) {
    const meta = getTraceMeta(event);
    if (meta.label) return humanizeQuestionId(String(meta.label), t);
  }
  const fallback = events[0]?.stage || "trace";
  return humanizeQuestionId(titleCase(fallback), t);
}

function getTraceCallKind(events: StreamEvent[]) {
  for (const event of events) {
    const meta = getTraceMeta(event);
    if (meta.call_kind) return String(meta.call_kind);
  }
  return "";
}

function getTraceRole(events: StreamEvent[]) {
  for (const event of events) {
    const meta = getTraceMeta(event);
    if (meta.trace_role) return String(meta.trace_role);
  }
  return "";
}

function getTraceGroup(events: StreamEvent[]) {
  for (const event of events) {
    const meta = getTraceMeta(event);
    if (meta.trace_group) return String(meta.trace_group);
  }
  return "";
}

/** 统一的秒数格式：保留一位小数（0.4s、6.3s），最低 0.1s 防止闪 0.0s */
function formatSeconds(seconds: number) {
  return `${Math.max(0.1, seconds).toFixed(1)}s`;
}

function getTraceDurationLabel(events: StreamEvent[]) {
  let start: number | null = null;
  let end: number | null = null;
  for (const event of events) {
    const state = String(getTraceMeta(event).call_state || "");
    if (state === "running" && start === null) start = event.timestamp;
    if ((state === "complete" || state === "error") && end === null)
      end = event.timestamp;
  }
  if (start === null || end === null) return "";
  return formatSeconds(end - start);
}

function getTraceStartTimestamp(events: StreamEvent[]) {
  for (const event of events) {
    const state = String(getTraceMeta(event).call_state || "");
    if (state === "running") return event.timestamp;
  }
  return null;
}

function getActiveTraceDurationSeconds(
  events: StreamEvent[],
  nowSeconds: number,
) {
  const start = getTraceStartTimestamp(events);
  if (start === null) return null;
  return Math.max(0.1, nowSeconds - start);
}

function isTracePending(events: StreamEvent[]) {
  let hasRunning = false;
  let hasTerminal = false;
  for (const event of events) {
    const state = String(getTraceMeta(event).call_state || "");
    if (state === "running") hasRunning = true;
    if (state === "complete" || state === "error") hasTerminal = true;
  }
  return hasRunning && !hasTerminal;
}

/** 只算行标题（不含用时后缀），供运行中行拼接活计时用 */
function getTraceTitle(
  events: StreamEvent[],
  nested?: boolean,
  t: (key: string, opts?: Record<string, unknown>) => string = (k) => k,
) {
  const label = getTraceLabel(events, t);
  const role = getTraceRole(events);
  const group = getTraceGroup(events);
  const kind = getTraceCallKind(events);
  const meta = getTraceMeta(events[0]);

  if (
    [
      "math_concept_analysis",
      "math_concept_design",
      "math_code_generation",
      "math_code_retry",
      "math_summary",
      "math_render_output",
    ].includes(kind)
  ) {
    return label;
  } else if (role === "retrieve") {
    return t("Retrieve");
  } else if (kind === "tool_planning") {
    return t("Tool call");
  } else if (group === "react_round") {
    if (nested) {
      return meta.round ? t("Round {{n}}", { n: meta.round }) : label;
    } else {
      const step = meta.step_id ? t("Step {{n}}", { n: meta.step_id }) : "";
      const round = meta.round ? t("Round {{n}}", { n: meta.round }) : label;
      return [step, round].filter(Boolean).join(" · ");
    }
  } else if (role === "plan" && kind === "llm_planning") {
    return t("Plan");
  } else if (role === "observe" || kind === "llm_observation") {
    return t("Observe");
  } else if (role === "response" || kind === "llm_final_response") {
    return t("Response");
  } else if (role === "thought" || kind === "llm_reasoning") {
    return t("Thought");
  } else if (kind === "llm_generation") {
    if (/^generate\s+/i.test(label)) {
      return t("Generating {{label}}", {
        label: label.replace(/^generate\s+/i, ""),
      });
    } else if (/^write\s+/i.test(label)) {
      return t("Writing {{label}}", {
        label: label.replace(/^write\s+/i, ""),
      });
    }
  }
  return label;
}

function getTraceHeader(
  events: StreamEvent[],
  nowSeconds?: number,
  nested?: boolean,
  t: (key: string, opts?: Record<string, unknown>) => string = (k) => k,
) {
  const title = getTraceTitle(events, nested, t);
  const kind = getTraceCallKind(events);
  const duration =
    kind === "math_render_output" && isTracePending(events) && nowSeconds
      ? formatSeconds(getActiveTraceDurationSeconds(events, nowSeconds) ?? 0.1)
      : getTraceDurationLabel(events);

  return duration
    ? t("{{title}} for {{duration}}", { title, duration })
    : title;
}

function getTraceText(
  events: StreamEvent[],
  eventTypes: Array<StreamEvent["type"]>,
) {
  const textEvents = events.filter(
    (event) =>
      eventTypes.includes(event.type) && event.content.trim().length > 0,
  );
  if (!textEvents.length) return "";

  const explicitOutputs = textEvents.filter(
    (event) => String(getTraceMeta(event).trace_kind || "") === "llm_output",
  );
  if (explicitOutputs.length > 0) {
    return explicitOutputs[explicitOutputs.length - 1].content;
  }

  return textEvents.map((event) => event.content).join("");
}

function formatTraceArgs(args: unknown) {
  if (args == null) return "";
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

/* ------------------------------------------------------------------ */
/*  Display-item grouping (step-level)                                 */
/* ------------------------------------------------------------------ */

function buildDisplayItems(traceGroups: TraceItem[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  let stepId_: string | null = null;
  let stepTraces: TraceItem[] = [];

  function flushStep() {
    if (stepId_ !== null && stepTraces.length > 0) {
      items.push({ kind: "step", stepId: stepId_, traces: stepTraces });
    }
    stepId_ = null;
    stepTraces = [];
  }

  for (const group of traceGroups) {
    const meta = getTraceMeta(group.events[0]);
    const groupType = getTraceGroup(group.events);
    const stepId = meta.step_id ? String(meta.step_id) : "";
    const kind = getTraceCallKind(group.events);

    if (kind === "llm_final_response") continue;

    if (groupType === "react_round" && stepId) {
      if (stepId_ === stepId) {
        stepTraces.push(group);
      } else {
        flushStep();
        stepId_ = stepId;
        stepTraces = [group];
      }
    } else if (stepId_ !== null && kind !== "llm_generation") {
      stepTraces.push(group);
    } else {
      flushStep();
      items.push({ kind: "trace", trace: group });
    }
  }
  flushStep();
  return items;
}

function getStepGroupDuration(traces: TraceItem[]): string {
  let start: number | null = null;
  let end: number | null = null;
  for (const trace of traces) {
    for (const event of trace.events) {
      const state = String(getTraceMeta(event).call_state || "");
      if (state === "running" && (start === null || event.timestamp < start))
        start = event.timestamp;
      if (
        (state === "complete" || state === "error") &&
        (end === null || event.timestamp > end)
      )
        end = event.timestamp;
    }
  }
  if (start === null || end === null) return "";
  return formatSeconds(end - start);
}

/* ------------------------------------------------------------------ */
/*  Primitive UI pieces                                                */
/* ------------------------------------------------------------------ */

function ScrollableTraceBody({
  children,
  autoScroll,
  className = "ml-5 mr-3 mt-0.5 max-h-[180px] overflow-y-auto px-3 py-1",
}: {
  children: React.ReactNode;
  autoScroll?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    if (!autoScroll || !stickRef.current) return;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  useEffect(() => {
    if (autoScroll) stickRef.current = true;
  }, [autoScroll]);

  const handleScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  }, []);

  return (
    <div ref={ref} onScroll={handleScroll} className={className}>
      {children}
    </div>
  );
}

/**
 * 行首状态格阵（React Bits LatticeLoader 移植件的调用封装）：
 * - 运行中（active）：南财红点亮 orbit 动画
 * - 正常结束：绿色 ✓ 标记格
 * - 出错：红色 ✕ 标记格
 * 取代了原先的 lucide 图标（Database/BrainCircuit/...）+ Loader2 旋转圈：
 * 行的类型靠文字（思考/工具调用/检索/观察）区分，图标统一交给格阵。
 */
function TraceStatusLattice({
  active,
  hasError,
  cellSize = 4,
  gap = 1.5,
}: {
  active: boolean;
  hasError: boolean;
  cellSize?: number;
  gap?: number;
}) {
  return (
    <LatticeLoader
      status={active ? "working" : hasError ? "error" : "done"}
      pattern="orbit"
      grid={3}
      cellSize={cellSize}
      gap={gap}
      color={active ? "var(--primary)" : "currentColor"}
      doneColor="#22c55e"
    />
  );
}

/**
 * 运行中行的活计时：每 100ms 自刷新，显示到小数点后一位（如 7.3s）。
 * 对应 React Bits LatticeLoader 原版内置计时器的观感——原版是组件内
 * setInterval 每 100ms 写 DOM，这里因为标题/计时由调用侧拼装，把计时
 * 拆成独立小组件而不是复用父级的 1s nowSeconds（整数精度不够）。
 * 只挂在 active 行上，静态行不产生任何定时器。
 */
function LiveDuration({ start }: { start: number }) {
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() / 1000), 100);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span className="tabular-nums">{formatSeconds(now - start)}</span>
  );
}

/** 一组 trace 里最早的运动开始时间（给 Step/Round 级活计时用） */
function getEarliestRunningStart(traceItems: TraceItem[]) {
  let earliest: number | null = null;
  for (const trace of traceItems) {
    for (const event of trace.events) {
      if (String(getTraceMeta(event).call_state || "") !== "running") continue;
      if (earliest === null || event.timestamp < earliest) {
        earliest = event.timestamp;
      }
    }
  }
  return earliest;
}


function TraceSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  if (!children) return null;
  return (
    <div className="space-y-0.5">
      <div className="not-italic text-[10px] font-semibold tracking-[0.04em] text-[var(--muted-foreground)]/70">
        {title}
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Per-trace rendering                                                */
/* ------------------------------------------------------------------ */

function TraceRowBody({
  callId,
  callEvents,
  group,
  role,
  kind,
  t,
}: {
  callId: string;
  callEvents: StreamEvent[];
  group: string;
  role: string;
  kind: string;
  t: (key: string) => string;
}) {
  const progressEvents = callEvents.filter((event) => {
    if (event.type !== "progress") return false;
    const traceKind = String(getTraceMeta(event).trace_kind || "");
    if (traceKind === "call_status") return false;
    return event.content.trim().length > 0;
  });
  const toolEvents = callEvents.filter(
    (event) => event.type === "tool_call" || event.type === "tool_result",
  );
  const summaryProgressEvents = progressEvents.filter(
    (event) => String(getTraceMeta(event).trace_layer || "summary") !== "raw",
  );
  const rawProgressEvents = progressEvents.filter(
    (event) => String(getTraceMeta(event).trace_layer || "") === "raw",
  );
  const errorEvents = callEvents.filter(
    (event) => event.type === "error" && event.content.trim().length > 0,
  );
  const thoughtText = getTraceText(callEvents, ["thinking"]);
  const observationText = getTraceText(callEvents, ["observation"]);
  const contentText = getTraceText(callEvents, ["content"]);
  const genericBodyText =
    role === "observe"
      ? observationText
      : role === "retrieve"
        ? ""
        : thoughtText || contentText;
  const inlineSources = callEvents.flatMap(
    (event) => getTraceMeta(event).sources ?? [],
  );

  return (
    <div className="text-[11px] italic leading-[1.6] text-[var(--muted-foreground)]">
      {group === "react_round" ? (
        <div className="space-y-2">
          <TraceSection title={t("Thought")}>
            {thoughtText ? (
              <MarkdownRenderer content={thoughtText} variant="trace" />
            ) : null}
          </TraceSection>
          <TraceSection title={t("Tool")}>
            {toolEvents.length > 0 ? (
              <div className="space-y-0.5">
                {toolEvents.map((event, idx) => {
                  if (event.type === "tool_call") {
                    const formattedArgs = formatTraceArgs(event.metadata?.args);
                    return (
                      <div key={`${callId}-tool-call-${idx}`}>
                        <span className="opacity-50">→ </span>
                        <span>{event.content}</span>
                        {formattedArgs && (
                          <pre className="ml-3 mt-0.5 whitespace-pre-wrap break-words rounded-md bg-[var(--muted)] px-2 py-1 font-mono text-[10px] not-italic leading-[1.5] text-[var(--muted-foreground)]">
                            {formattedArgs}
                          </pre>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div key={`${callId}-tool-result-${idx}`}>
                      <span className="opacity-50">✓ </span>
                      <span>{String(event.metadata?.tool ?? "result")}</span>
                      {event.content && (
                        <div className="ml-3 mt-0.5">
                          <MarkdownRenderer
                            content={event.content}
                            variant="trace"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </TraceSection>
          <TraceSection title={t("Observe")}>
            {observationText ? (
              <MarkdownRenderer content={observationText} variant="trace" />
            ) : null}
          </TraceSection>
        </div>
      ) : (
        <div className="space-y-1">
          {summaryProgressEvents.length > 0 && (
            <div className="space-y-0.5">
              {summaryProgressEvents.map((event, idx) => (
                <div key={`${callId}-progress-${idx}`} className="opacity-70">
                  {event.content}
                </div>
              ))}
            </div>
          )}

          {(role === "retrieve" || kind === "math_render_output") &&
            rawProgressEvents.length > 0 && (
              <div className="space-y-0.5">
                <div className="not-italic text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
                  {t("Raw logs")}
                </div>
                <div className="max-h-[200px] overflow-y-auto rounded-md border border-[var(--border)] bg-[#292524] px-3 py-2 font-mono text-[10px] leading-[1.55] text-[#D6D3D1] shadow-inner">
                  {rawProgressEvents.map((event, idx) => (
                    <div
                      key={`${callId}-raw-${idx}`}
                      className="whitespace-pre-wrap break-words"
                    >
                      {event.content}
                    </div>
                  ))}
                </div>
              </div>
            )}

          {toolEvents.length > 0 && (
            <div className="space-y-0.5">
              {toolEvents.map((event, idx) => {
                if (event.type === "tool_call") {
                  const formattedArgs = formatTraceArgs(event.metadata?.args);
                  return (
                    <div key={`${callId}-tool-call-${idx}`}>
                      <span className="opacity-50">→ </span>
                      <span>{event.content}</span>
                      {formattedArgs && (
                        <pre className="ml-3 mt-0.5 whitespace-pre-wrap break-words rounded-md bg-[var(--muted)] px-2 py-1 font-mono text-[10px] not-italic leading-[1.5] text-[var(--muted-foreground)]">
                          {formattedArgs}
                        </pre>
                      )}
                    </div>
                  );
                }
                return (
                  <div key={`${callId}-tool-result-${idx}`}>
                    <span className="opacity-50">✓ </span>
                    <span>{String(event.metadata?.tool ?? "result")}</span>
                    {event.content && (
                      <div className="ml-3 mt-0.5">
                        <MarkdownRenderer
                          content={event.content}
                          variant="trace"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {genericBodyText && (
            <div className="mt-1">
              <MarkdownRenderer content={genericBodyText} variant="trace" />
            </div>
          )}
        </div>
      )}

      {inlineSources.length > 0 && (
        <div className="mt-1 opacity-50">
          {t("Sources")}:{" "}
          {inlineSources.map((source, idx) => (
            <span key={`${callId}-source-${idx}`}>
              {idx > 0 && " · "}
              {String(source.title || source.query || source.type || "source")}
            </span>
          ))}
        </div>
      )}

      {errorEvents.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {errorEvents.map((event, idx) => (
            <div key={`${callId}-error-${idx}`} className="text-red-400/80">
              ✗ {event.content}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function hasExpandableContent(
  callEvents: StreamEvent[],
  group: string,
  role: string,
) {
  const progressEvents = callEvents.filter((event) => {
    if (event.type !== "progress") return false;
    const traceKind = String(getTraceMeta(event).trace_kind || "");
    if (traceKind === "call_status") return false;
    return event.content.trim().length > 0;
  });
  const toolEvents = callEvents.filter(
    (event) => event.type === "tool_call" || event.type === "tool_result",
  );
  const summaryProgressEvents = progressEvents.filter(
    (event) => String(getTraceMeta(event).trace_layer || "summary") !== "raw",
  );
  const rawProgressEvents = progressEvents.filter(
    (event) => String(getTraceMeta(event).trace_layer || "") === "raw",
  );
  const errorEvents = callEvents.filter(
    (event) => event.type === "error" && event.content.trim().length > 0,
  );
  const thoughtText = getTraceText(callEvents, ["thinking"]);
  const observationText = getTraceText(callEvents, ["observation"]);
  const contentText = getTraceText(callEvents, ["content"]);
  const genericBodyText =
    role === "observe"
      ? observationText
      : role === "retrieve"
        ? ""
        : thoughtText || contentText;
  const inlineSources = callEvents.flatMap(
    (event) => getTraceMeta(event).sources ?? [],
  );

  return (
    toolEvents.length > 0 ||
    summaryProgressEvents.length > 0 ||
    rawProgressEvents.length > 0 ||
    errorEvents.length > 0 ||
    Boolean(genericBodyText) ||
    inlineSources.length > 0 ||
    (group === "react_round" &&
      (Boolean(thoughtText) || Boolean(observationText)))
  );
}

/* ------------------------------------------------------------------ */
/*  CallTracePanel                                                     */
/* ------------------------------------------------------------------ */

export function CallTracePanel({
  events,
  isStreaming,
}: {
  events: StreamEvent[];
  isStreaming?: boolean;
}) {
  const { t } = useTranslation();
  const [nowSeconds, setNowSeconds] = useState(() => Date.now() / 1000);

  useEffect(() => {
    if (!isStreaming) return;
    const timer = window.setInterval(
      () => setNowSeconds(Date.now() / 1000),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [isStreaming]);

  const traceGroups = useMemo(() => {
    const groups: TraceItem[] = [];
    const indexById = new Map<string, number>();

    for (const event of events) {
      const callId = String(getTraceMeta(event).call_id || "");
      if (!callId) continue;
      const existingIndex = indexById.get(callId);
      if (existingIndex === undefined) {
        indexById.set(callId, groups.length);
        groups.push({ callId, events: [event] });
      } else {
        groups[existingIndex].events.push(event);
      }
    }

    return groups;
  }, [events]);

  const displayItems = useMemo(
    () => buildDisplayItems(traceGroups),
    [traceGroups],
  );

  if (!traceGroups.length) return null;

  function renderTraceRow(
    { callId, events: callEvents }: TraceItem,
    isGloballyLast: boolean,
    nested: boolean,
  ) {
    const role = getTraceRole(callEvents);
    const group = getTraceGroup(callEvents);
    const kind = getTraceCallKind(callEvents);
    const header = getTraceHeader(callEvents, nowSeconds, nested, t);
    const active =
      Boolean(isStreaming) && isGloballyLast && isTracePending(callEvents);
    const isFinalResponse = kind === "llm_final_response";

    if (isFinalResponse) return null;

    const expandable = hasExpandableContent(callEvents, group, role);
    if (!expandable && !active) return null;

    const activeStart = active ? getTraceStartTimestamp(callEvents) : null;

    const summaryRow = (
      <div className="flex list-none items-center gap-2 py-0.5 not-italic text-[12px] font-medium text-[var(--muted-foreground)]">
        {expandable ? (
          <ChevronDown
            size={12}
            className="shrink-0 transition-transform group-open:rotate-180"
          />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <TraceStatusLattice
          active={active}
          hasError={callEvents.some((event) => event.type === "error")}
        />
        {activeStart !== null ? (
          // 运行中：标题 + 每百毫秒跳动的活计时（对齐 LatticeLoader 原版观感）
          <span>
            {getTraceTitle(callEvents, nested, t)}
            <span className="opacity-60"> · </span>
            <LiveDuration start={activeStart} />
          </span>
        ) : (
          <span>{header}</span>
        )}
      </div>
    );

    if (!expandable) {
      return <div key={callId}>{summaryRow}</div>;
    }

    return (
      <details key={callId} open={active} className="group">
        <summary className="list-none cursor-pointer hover:text-[var(--foreground)] [&::-webkit-details-marker]:hidden">
          {summaryRow}
        </summary>
        {nested ? (
          <div className="ml-5 mr-3 mt-0.5 px-3 py-1">
            <TraceRowBody
              callId={callId}
              callEvents={callEvents}
              group={group}
              role={role}
              kind={kind}
              t={t}
            />
          </div>
        ) : (
          <ScrollableTraceBody autoScroll={active}>
            <TraceRowBody
              callId={callId}
              callEvents={callEvents}
              group={group}
              role={role}
              kind={kind}
              t={t}
            />
          </ScrollableTraceBody>
        )}
      </details>
    );
  }

  return (
    <div className="mb-3 space-y-0.5">
      {displayItems.map((item, displayIdx) => {
        const isLastDisplayItem = displayIdx === displayItems.length - 1;

        if (item.kind === "step") {
          const roundCount = item.traces.filter(
            (tr) => getTraceGroup(tr.events) === "react_round",
          ).length;
          const lastTrace = item.traces[item.traces.length - 1];
          const isActiveStep =
            Boolean(isStreaming) &&
            isLastDisplayItem &&
            isTracePending(lastTrace.events);
          const stepActiveStart = isActiveStep
            ? getEarliestRunningStart(item.traces)
            : null;
          const stepDuration = stepActiveStart
            ? ""
            : getStepGroupDuration(item.traces);

          return (
            <details
              key={item.stepId}
              open={isActiveStep || undefined}
              className="group/step"
            >
              <summary className="list-none cursor-pointer hover:text-[var(--foreground)] [&::-webkit-details-marker]:hidden">
                <div className="flex items-center gap-2 py-0.5 not-italic text-[12px] font-medium text-[var(--muted-foreground)]">
                  <ChevronDown
                    size={12}
                    className="shrink-0 transition-transform group-open/step:rotate-180"
                  />
                  <TraceStatusLattice
                    active={isActiveStep}
                    hasError={false}
                  />
                  <span>Step {item.stepId}</span>
                  <span className="text-[11px] opacity-60">
                    {roundCount} {roundCount === 1 ? "round" : "rounds"}
                    {stepActiveStart !== null ? (
                      <>
                        {" · "}
                        <LiveDuration start={stepActiveStart} />
                      </>
                    ) : stepDuration ? (
                      ` · ${stepDuration}`
                    ) : (
                      ""
                    )}
                  </span>
                </div>
              </summary>
              <ScrollableTraceBody
                autoScroll={isActiveStep}
                className="ml-5 mr-3 mt-0.5 max-h-[280px] overflow-y-auto px-3 py-1"
              >
                <div className="text-[11px] italic leading-[1.6] text-[var(--muted-foreground)]">
                  {item.traces.map((trace, idx) => {
                    const trGroup = getTraceGroup(trace.events);
                    const trKind = getTraceCallKind(trace.events);
                    const trRole = getTraceRole(trace.events);
                    const trMeta = getTraceMeta(trace.events[0]);

                    if (trKind === "llm_final_response") return null;

                    if (trGroup === "react_round") {
                      const roundNum = trMeta.round;
                      const duration = getTraceDurationLabel(trace.events);
                      const thoughtText = getTraceText(trace.events, [
                        "thinking",
                      ]);
                      const observationText = getTraceText(trace.events, [
                        "observation",
                      ]);
                      const traceToolEvents = trace.events.filter(
                        (e) =>
                          e.type === "tool_call" || e.type === "tool_result",
                      );
                      const isLastInStep = idx === item.traces.length - 1;
                      const roundActive =
                        Boolean(isStreaming) &&
                        isLastDisplayItem &&
                        isLastInStep &&
                        isTracePending(trace.events);

                      return (
                        <div key={trace.callId}>
                          {idx > 0 && (
                            <div className="my-1.5 h-px bg-[var(--border)]/30" />
                          )}
                          <div className="mb-1 flex items-center gap-1.5 not-italic text-[11px]">
                            <span className="font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
                              Round {roundNum}
                            </span>
                            {roundActive ? (
                              <>
                                <LiveDuration
                                  start={
                                    getTraceStartTimestamp(trace.events) ??
                                    Date.now() / 1000
                                  }
                                />
                                <TraceStatusLattice
                                  active
                                  hasError={false}
                                  cellSize={3}
                                  gap={1}
                                />
                              </>
                            ) : (
                              duration && (
                                <span className="font-normal text-[var(--muted-foreground)]/40">
                                  {duration}
                                </span>
                              )
                            )}
                          </div>
                          <div className="space-y-1.5 pl-0.5">
                            <TraceSection title={t("Thought")}>
                              {thoughtText ? (
                                <MarkdownRenderer
                                  content={thoughtText}
                                  variant="trace"
                                />
                              ) : null}
                            </TraceSection>
                            <TraceSection title={t("Tool")}>
                              {traceToolEvents.length > 0 ? (
                                <div className="space-y-0.5">
                                  {traceToolEvents.map((ev, ei) => {
                                    if (ev.type === "tool_call") {
                                      const fa = formatTraceArgs(
                                        ev.metadata?.args,
                                      );
                                      return (
                                        <div key={`${trace.callId}-tc-${ei}`}>
                                          <span className="opacity-50">→ </span>
                                          <span>{ev.content}</span>
                                          {fa && (
                                            <pre className="ml-3 mt-0.5 whitespace-pre-wrap break-words rounded-md bg-[var(--muted)] px-2 py-1 font-mono text-[10px] not-italic leading-[1.5] text-[var(--muted-foreground)]">
                                              {fa}
                                            </pre>
                                          )}
                                        </div>
                                      );
                                    }
                                    return (
                                      <div key={`${trace.callId}-tr-${ei}`}>
                                        <span className="opacity-50">✓ </span>
                                        <span>
                                          {String(
                                            ev.metadata?.tool ?? "result",
                                          )}
                                        </span>
                                        {ev.content && (
                                          <div className="ml-3 mt-0.5">
                                            <MarkdownRenderer
                                              content={ev.content}
                                              variant="trace"
                                            />
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </TraceSection>
                            <TraceSection title={t("Observe")}>
                              {observationText ? (
                                <MarkdownRenderer
                                  content={observationText}
                                  variant="trace"
                                />
                              ) : null}
                            </TraceSection>
                          </div>
                        </div>
                      );
                    }

                    /* Non-round trace (retrieve, tool, etc.) — inline within the step */
                    const inlineHeader = getTraceHeader(
                      trace.events,
                      nowSeconds,
                      true,
                      t,
                    );
                    const progressEvts = trace.events.filter(
                      (e) =>
                        e.type === "progress" &&
                        String(getTraceMeta(e).trace_kind || "") !==
                          "call_status" &&
                        e.content.trim().length > 0,
                    );
                    const rawEvts = progressEvts.filter(
                      (e) =>
                        String(getTraceMeta(e).trace_layer || "") === "raw",
                    );
                    const summaryEvts = progressEvts.filter(
                      (e) =>
                        String(getTraceMeta(e).trace_layer || "summary") !==
                        "raw",
                    );
                    const inlineToolEvts = trace.events.filter(
                      (e) => e.type === "tool_call" || e.type === "tool_result",
                    );
                    const genericText =
                      trRole === "observe"
                        ? getTraceText(trace.events, ["observation"])
                        : trRole === "retrieve"
                          ? ""
                          : getTraceText(trace.events, ["thinking"]) ||
                            getTraceText(trace.events, ["content"]);

                    const hasContent =
                      summaryEvts.length > 0 ||
                      rawEvts.length > 0 ||
                      inlineToolEvts.length > 0 ||
                      Boolean(genericText);
                    if (!hasContent) return null;

                    return (
                      <div key={trace.callId} className="mt-1.5 pl-0.5">
                        <div className="not-italic text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
                          {inlineHeader}
                        </div>
                        <div className="mt-0.5 space-y-0.5">
                          {summaryEvts.map((ev, ei) => (
                            <div
                              key={`${trace.callId}-sp-${ei}`}
                              className="opacity-70"
                            >
                              {ev.content}
                            </div>
                          ))}
                          {(trRole === "retrieve" ||
                            trKind === "math_render_output") &&
                            rawEvts.length > 0 && (
                              <div className="max-h-[160px] overflow-y-auto rounded-md border border-[var(--border)] bg-[#292524] px-3 py-2 font-mono text-[10px] not-italic leading-[1.55] text-[#D6D3D1] shadow-inner">
                                {rawEvts.map((ev, ei) => (
                                  <div
                                    key={`${trace.callId}-rw-${ei}`}
                                    className="whitespace-pre-wrap break-words"
                                  >
                                    {ev.content}
                                  </div>
                                ))}
                              </div>
                            )}
                          {inlineToolEvts.map((ev, ei) => (
                            <div key={`${trace.callId}-it-${ei}`}>
                              <span className="opacity-50">
                                {ev.type === "tool_call" ? "→ " : "✓ "}
                              </span>
                              <span>
                                {ev.type === "tool_call"
                                  ? ev.content
                                  : String(ev.metadata?.tool ?? "result")}
                              </span>
                            </div>
                          ))}
                          {genericText && (
                            <div className="mt-0.5">
                              <MarkdownRenderer
                                content={genericText}
                                variant="trace"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollableTraceBody>
            </details>
          );
        }

        return renderTraceRow(item.trace, isLastDisplayItem, false);
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ResearchStagePanel                                                 */
/* ------------------------------------------------------------------ */

function getResearchStageId(event: StreamEvent): ResearchStageCard["id"] {
  const meta = getTraceMeta(event);
  const explicitStage = String(
    (event.metadata as Record<string, unknown> | undefined)
      ?.research_stage_card || "",
  );
  if (
    explicitStage === "understand" ||
    explicitStage === "decompose" ||
    explicitStage === "evidence" ||
    explicitStage === "result"
  ) {
    return explicitStage;
  }
  const stage = String(event.stage || meta.phase || "");
  const text = String(event.content || "").toLowerCase();
  const agent = String(
    (event.metadata as Record<string, unknown> | undefined)?.agent_name || "",
  );

  if (stage === "reporting") return "result";
  if (stage === "decomposing" || agent === "decompose_agent")
    return "decompose";
  if (stage === "rephrasing" || agent === "rephrase_agent") return "understand";
  if (stage === "planning") {
    if (text.includes("decompose") || text.includes("queue"))
      return "decompose";
    return "understand";
  }
  return "evidence";
}

function formatResearchStageSummary(events: StreamEvent[], fallback: string) {
  const progressEvents = events.filter(
    (event) => event.type === "progress" && event.content.trim().length > 0,
  );
  const lastProgress = progressEvents.at(-1)?.content.trim();
  if (lastProgress) {
    return humanizeQuestionId(titleCase(lastProgress.replaceAll("-", "_")));
  }

  const thought = getTraceText(events, ["thinking"]);
  if (thought) return thought.slice(0, 120);

  const content = getTraceText(events, ["content"]);
  if (content) return content.slice(0, 120);

  return fallback;
}

export function ResearchStagePanel({
  events,
  isStreaming,
}: {
  events: StreamEvent[];
  isStreaming?: boolean;
}) {
  const { t } = useTranslation();
  const cards = useMemo<ResearchStageCard[]>(() => {
    return RESEARCH_STAGE_SPECS.map((spec) => ({
      id: spec.id,
      title: t(spec.titleKey),
      hint: t(spec.hintKey),
      events: events.filter((event) => getResearchStageId(event) === spec.id),
    })).filter((card) => card.events.length > 0);
  }, [events, t]);

  if (!cards.length) return null;

  return (
    <div className="mb-3 space-y-0.5">
      {cards.map((card, index) => {
        const hasTrace = card.events.some((event) =>
          Boolean(getTraceMeta(event).call_id),
        );
        const active =
          Boolean(isStreaming) &&
          index === cards.length - 1 &&
          card.events.some(
            (event) => isTracePending([event]) || event.type === "progress",
          );
        const summary = formatResearchStageSummary(card.events, card.hint);

        return (
          <div key={card.id}>
            <div className="flex items-center gap-2 py-1 text-[12px] text-[var(--muted-foreground)]">
              <span className="font-semibold">{card.title}</span>
              <span className="text-[11px] opacity-60">{summary}</span>
              {active && (
                <TraceStatusLattice active hasError={false} />
              )}
            </div>
            {hasTrace ? (
              <CallTracePanel events={card.events} isStreaming={isStreaming} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
