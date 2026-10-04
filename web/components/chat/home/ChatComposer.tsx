"use client";

import dynamic from "next/dynamic";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import Image from "next/image";
import {
  ArrowUp,
  AtSign,
  ChevronDown,
  Database,
  Layers,
  Paperclip,
  Sparkles,
  Square,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  ATTACHMENT_ACCEPT,
  docIconFor,
  formatBytes,
  isSvgFilename,
} from "@/lib/doc-attachments";
import { useTranslation } from "react-i18next";
import type { SelectedHistorySession } from "@/components/chat/HistorySessionPicker";
import type { SelectedQuestionEntry } from "@/components/chat/QuestionBankPicker";
import type { SelectedRecord } from "@/lib/notebook-selection-types";
import type { DeepQuestionFormConfig } from "@/lib/quiz-types";
import type { MathAnimatorFormConfig } from "@/lib/math-animator-types";
import type { VisualizeFormConfig } from "@/lib/visualize-types";
import type { LLMSelection } from "@/lib/unified-ws";
import type { LLMOption } from "@/lib/llm-options";
import type {
  DeepResearchFormConfig,
  ResearchSource,
} from "@/lib/research-types";
import ChatSpaceMenu from "@/components/chat/space/ChatSpaceMenu";
import type { SpaceMemoryFile } from "@/lib/space-items";
import type { SelectedBookReference } from "@/lib/book-references";
import ModelSelector from "./ModelSelector";

type SpaceSelectionCounts = {
  chatHistory: number;
  books: number;
  notebooks: number;
  questionBank: number;
  skills: number;
  memory: number;
};
import { SpaceContextChips } from "./ChatMessages";
import { ComposerInput, type ComposerInputHandle } from "./ComposerInput";

const QuizConfigPanel = dynamic(
  () => import("@/components/quiz/QuizConfigPanel"),
  {
    ssr: false,
  },
);
const MathAnimatorConfigPanel = dynamic(
  () => import("@/components/math-animator/MathAnimatorConfigPanel"),
  { ssr: false },
);
const ResearchConfigPanel = dynamic(
  () => import("@/components/research/ResearchConfigPanel"),
  { ssr: false },
);
const VisualizeConfigPanel = dynamic(
  () => import("@/components/visualize/VisualizeConfigPanel"),
  { ssr: false },
);

interface PendingAttachment {
  type: string;
  filename: string;
  base64?: string;
  previewUrl?: string;
  size?: number;
  mimeType?: string;
}

interface KnowledgeBase {
  name: string;
}

interface CapabilityDef {
  value: string;
  label: string;
  description: string;
  icon: LucideIcon;
  allowedTools: string[];
}

interface ToolDef {
  name: string;
  label: string;
  icon: LucideIcon;
}

interface ResearchSourceDef {
  name: ResearchSource;
  label: string;
  icon: LucideIcon;
}

export default memo(function ChatComposer({
  composerRef,
  capMenuRef,
  capBtnRef,
  toolMenuRef,
  toolBtnRef,
  spaceMenuRef,
  spaceBtnRef,
  dragCounter,
  dragging,
  capMenuOpen,
  toolMenuOpen,
  spaceMenuOpen,
  hasMessages,
  attachments,
  attachmentError,
  activeCap,
  visibleTools,
  selectedTools,
  ragActive,
  knowledgeBases,
  llmOptions,
  activeLLMDefault,
  llmSelection,
  llmOptionsLoading,
  llmOptionsError,
  selectedNotebookRecords,
  selectedBookReferences,
  selectedHistorySessions,
  selectedQuestionEntries,
  notebookReferenceGroups,
  selectedSkills,
  skillsAutoMode,
  selectedMemoryFiles,
  stateKnowledgeBases,
  kbMenuOpen,
  kbMenuRef,
  kbBtnRef,
  isStreaming,
  isResearchMode,
  isQuizMode,
  isMathAnimatorMode,
  isVisualizeMode,
  quizConfig,
  quizPdf,
  mathAnimatorConfig,
  visualizeConfig,
  researchConfig,
  researchValidationErrors,
  panelCollapsed,
  capabilities,
  researchSources,
  onSetCapMenuOpen,
  onSetToolMenuOpen,
  onSetSpaceMenuOpen,
  onToggleKB,
  onSetKbMenuOpen,
  onSelectLLM,
  onSelectNotebookPicker,
  onSelectBookPicker,
  onSelectHistoryPicker,
  onSelectQuestionBankPicker,
  onSelectSkillsPicker,
  onSelectMemoryPicker,
  onToggleTool,
  onToggleSkill,
  onSetSkillsAuto,
  onToggleMemoryFile,
  onToggleResearchSource,
  onSend,
  onRemoveAttachment,
  onPreviewAttachment,
  onRemoveHistory,
  onRemoveBookReference,
  onRemoveNotebook,
  onRemoveQuestion,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onPaste,
  onAddFiles,
  onSelectCapability,
  onCancelStreaming,
  onChangeQuizConfig,
  onUploadQuizPdf,
  onChangeMathAnimatorConfig,
  onChangeVisualizeConfig,
  onChangeResearchConfig,
  onTogglePanelCollapsed,
  onHasContentChange,
}: {
  composerRef: RefObject<HTMLDivElement | null>;
  capMenuRef: RefObject<HTMLDivElement | null>;
  capBtnRef: RefObject<HTMLButtonElement | null>;
  toolMenuRef: RefObject<HTMLDivElement | null>;
  toolBtnRef: RefObject<HTMLButtonElement | null>;
  spaceMenuRef: RefObject<HTMLDivElement | null>;
  spaceBtnRef: RefObject<HTMLButtonElement | null>;
  dragCounter: RefObject<number>;
  dragging: boolean;
  capMenuOpen: boolean;
  toolMenuOpen: boolean;
  spaceMenuOpen: boolean;
  hasMessages: boolean;
  attachments: PendingAttachment[];
  attachmentError: string | null;
  activeCap: CapabilityDef;
  visibleTools: ToolDef[];
  selectedTools: Set<string>;
  ragActive: boolean;
  knowledgeBases: KnowledgeBase[];
  llmOptions: LLMOption[];
  activeLLMDefault: LLMSelection | null;
  llmSelection: LLMSelection | null;
  llmOptionsLoading: boolean;
  llmOptionsError: boolean;
  selectedNotebookRecords: SelectedRecord[];
  selectedBookReferences: SelectedBookReference[];
  selectedHistorySessions: SelectedHistorySession[];
  selectedQuestionEntries: SelectedQuestionEntry[];
  notebookReferenceGroups: Array<{
    notebookId: string;
    notebookName: string;
    count: number;
  }>;
  selectedSkills: string[];
  skillsAutoMode: boolean;
  selectedMemoryFiles: SpaceMemoryFile[];
  stateKnowledgeBases: string[];
  kbMenuOpen: boolean;
  kbMenuRef: RefObject<HTMLDivElement | null>;
  kbBtnRef: RefObject<HTMLButtonElement | null>;
  isStreaming: boolean;
  isResearchMode: boolean;
  isQuizMode: boolean;
  isMathAnimatorMode: boolean;
  isVisualizeMode: boolean;
  quizConfig: DeepQuestionFormConfig;
  quizPdf: File | null;
  mathAnimatorConfig: MathAnimatorFormConfig;
  visualizeConfig: VisualizeFormConfig;
  researchConfig: DeepResearchFormConfig;
  researchValidationErrors: Record<string, string>;
  panelCollapsed: boolean;
  capabilities: CapabilityDef[];
  researchSources: ResearchSourceDef[];
  onSetCapMenuOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  onSetToolMenuOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  onSetSpaceMenuOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  onToggleKB: (kb: string) => void;
  onSetKbMenuOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  onSelectLLM: (selection: LLMSelection | null) => void;
  onSelectNotebookPicker: () => void;
  onSelectBookPicker: () => void;
  onSelectHistoryPicker: () => void;
  onSelectQuestionBankPicker: () => void;
  onSelectSkillsPicker: () => void;
  onSelectMemoryPicker: () => void;
  onToggleTool: (tool: ToolDef["name"]) => void;
  onToggleSkill: (skill: string) => void;
  onSetSkillsAuto: (auto: boolean) => void;
  onToggleMemoryFile: (file: SpaceMemoryFile) => void;
  onToggleResearchSource: (source: ResearchSource) => void;
  onSend: (content: string) => void;
  onRemoveAttachment: (index: number) => void;
  onPreviewAttachment?: (index: number) => void;
  onRemoveHistory: (sessionId: string) => void;
  onRemoveBookReference: (bookId: string) => void;
  onRemoveNotebook: (notebookId: string) => void;
  onRemoveQuestion: (entryId: number) => void;
  onDragEnter: (event: React.DragEvent) => void;
  onDragLeave: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  onPaste: (event: React.ClipboardEvent) => void;
  onAddFiles: (files: File[]) => void;
  onSelectCapability: (value: string) => void;
  onCancelStreaming: () => void;
  onChangeQuizConfig: (next: DeepQuestionFormConfig) => void;
  onUploadQuizPdf: (file: File | null) => void;
  onChangeMathAnimatorConfig: (next: MathAnimatorFormConfig) => void;
  onChangeVisualizeConfig: (next: VisualizeFormConfig) => void;
  onChangeResearchConfig: (next: DeepResearchFormConfig) => void;
  onTogglePanelCollapsed: () => void;
  /** 输入框里是否有字（trim 后非空）发生变化时回调。给表情球用：
   *  用户在打字时球要切成「倾听」。注意是**有内容**而不是**聚焦**。 */
  onHasContentChange?: (hasContent: boolean) => void;
}) {
  const { t } = useTranslation();
  const CapIcon = activeCap.icon;

  const [hasContent, setHasContent] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputHandleRef = useRef<ComposerInputHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* 工具栏自适应压缩：右侧源文件面板会挤窄输入框，而工具栏按钮全是 shrink-0，
   * 空间不够时中间组会直接叠到右边的模型选择器上（真出过）。用 ResizeObserver
   * 盯工具栏自身宽度（不是窗口宽度——挤压来自面板分栏，窗口宽度不变），分两档收：
   *   level 1（<600px）：收起中间组「工具/附件/空间」的文字，只留图标；
   *   level 2（<480px）：连「聊天」「知识库」的文字也收起。
   * 阈值按实测校准：工具栏内容自然总宽 519px（中组 186 + 右组 239 + 聊天 69 +
   * 分隔线），level1 后 ≈457、level2 后 ≈407，各档留 ~20px 余量。
   * 不用等比缩放：0.75 倍 zoom 会把 11px 的字缩到 8px 看不清；藏字保图标是
   * 主流聊天输入框的做法，语义不丢（每个按钮都有 title/aria-label）。 */
  const toolbarRowRef = useRef<HTMLDivElement>(null);
  const [toolbarLevel, setToolbarLevel] = useState(0);
  useEffect(() => {
    const el = toolbarRowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      setToolbarLevel(w < 480 ? 2 : w < 600 ? 1 : 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handlePickFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const picked = Array.from(event.target.files ?? []);
      if (picked.length) onAddFiles(picked);
      // Reset so picking the same file twice still triggers `change`.
      event.target.value = "";
    },
    [onAddFiles],
  );

  const activeCapabilityKey = activeCap.value || "chat";

  useEffect(() => {
    if (!hasMessages) textareaRef.current?.focus();
  }, [hasMessages]);

  // Functional-update form keeps `handleInputChange` identity stable across
  // every keystroke (no `hasContent` in deps), so the memoized ComposerInput
  // doesn't get re-rendered just because we observed a content-empty toggle.
  const handleInputChange = useCallback((val: string) => {
    const next = !!val.trim();
    setHasContent((prev) => (prev === next ? prev : next));
  }, []);

  /* 把"框里有字"这个状态透出去（表情球的「倾听」）。
   * 挂在 hasContent 上而不是在 handleInputChange 里调：发送后走的是 doSend 里的
   * setHasContent(false)，从这里统一回调才不会漏掉"发完变空"那一次。
   * 回调存 ref：调用方传内联箭头函数也不会让这个 effect 每次渲染都重跑。 */
  const hasContentCbRef = useRef(onHasContentChange);
  hasContentCbRef.current = onHasContentChange;
  useEffect(() => {
    hasContentCbRef.current?.(hasContent);
  }, [hasContent]);

  const doSend = useCallback(
    (content: string) => {
      onSend(content);
      setHasContent(false);
      inputHandleRef.current?.clear();
    },
    [onSend],
  );

  const hasReferences =
    !!attachments.length ||
    !!selectedBookReferences.length ||
    !!selectedNotebookRecords.length ||
    !!selectedHistorySessions.length ||
    !!selectedQuestionEntries.length ||
    !!selectedSkills.length ||
    skillsAutoMode ||
    !!selectedMemoryFiles.length;

  const canSend =
    (hasContent || hasReferences) &&
    !isStreaming &&
    !(isResearchMode && Object.keys(researchValidationErrors).length > 0);

  const skillsCount = skillsAutoMode ? 1 : selectedSkills.length;
  const spaceSelectionCounts: SpaceSelectionCounts = {
    chatHistory: selectedHistorySessions.length,
    books: selectedBookReferences.reduce(
      (total, ref) => total + ref.pages.length,
      0,
    ),
    notebooks: selectedNotebookRecords.length,
    questionBank: selectedQuestionEntries.length,
    skills: skillsCount,
    memory: selectedMemoryFiles.length,
  };
  const spaceSelectionCount =
    spaceSelectionCounts.chatHistory +
    spaceSelectionCounts.books +
    spaceSelectionCounts.notebooks +
    spaceSelectionCounts.questionBank +
    spaceSelectionCounts.skills +
    spaceSelectionCounts.memory;

  const handleManualSend = useCallback(() => {
    if (!canSend) return;
    const content = inputHandleRef.current?.getValue() || "";
    doSend(content);
  }, [canSend, doSend]);

  return (
    <div
      ref={composerRef}
      className={`relative z-20 mx-auto w-full shrink-0 pb-5 ${hasMessages ? "pt-1" : ""}`}
    >
      {hasMessages && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-transparent to-[var(--background)]/72" />
      )}

      {capMenuOpen && (
        <div
          ref={capMenuRef}
          className="absolute bottom-full left-0 right-0 z-50 mb-1"
        >
          <div className="mx-auto">
            <div className="w-[280px] rounded-xl border border-[var(--border)] bg-[var(--popover)] py-1.5 shadow-lg backdrop-blur-md">
              {capabilities.map((cap) => {
                const Icon = cap.icon;
                const selected = activeCap.value === cap.value;
                return (
                  <button
                    key={cap.value}
                    onClick={() => onSelectCapability(cap.value)}
                    className={`flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors ${
                      selected
                        ? "bg-[var(--muted)]"
                        : "hover:bg-[var(--muted)]/50"
                    }`}
                  >
                    <Icon
                      size={16}
                      strokeWidth={1.6}
                      className={`shrink-0 ${selected ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-[var(--foreground)]">
                        {t(cap.label)}
                      </div>
                      <div className="truncate text-[11px] text-[var(--muted-foreground)]">
                        {t(cap.description)}
                      </div>
                    </div>
                    {selected && (
                      <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--primary)]" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="relative">
        <div
          className={`relative rounded-2xl border bg-[var(--card)] shadow-[0_1px_8px_rgba(0,0,0,0.03)] transition-colors ${
            dragging
              ? "border-[var(--primary)] bg-[var(--primary)]/[0.03]"
              : "border-[var(--border)]"
          }`}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          data-drag-counter={dragCounter.current}
        >
          {dragging && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-[var(--primary)]/50 bg-[var(--primary)]/[0.04]">
              <div className="flex flex-col items-center gap-1 text-[var(--primary)]">
                <Paperclip size={22} strokeWidth={1.6} />
                <span className="text-[13px] font-medium">
                  {t("Drop files here")}
                </span>
                <span className="text-[11px] text-[var(--primary)]/70">
                  {t("Images, Office docs, code & text")}
                </span>
              </div>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            onChange={handleFileInputChange}
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
          />

          {hasReferences && (
            <div className="px-4 pt-3.5 [&>div]:mb-0">
              <SpaceContextChips
                historySessions={selectedHistorySessions}
                bookReferences={selectedBookReferences}
                notebookGroups={notebookReferenceGroups}
                questionEntries={selectedQuestionEntries}
                selectedSkills={selectedSkills}
                skillsAutoMode={skillsAutoMode}
                memoryFiles={selectedMemoryFiles}
                onRemoveHistory={onRemoveHistory}
                onRemoveBookReference={onRemoveBookReference}
                onRemoveNotebook={onRemoveNotebook}
                onRemoveQuestion={onRemoveQuestion}
                onRemoveSkill={onToggleSkill}
                onClearSkillsAuto={() => onSetSkillsAuto(false)}
                onRemoveMemoryFile={onToggleMemoryFile}
              />
            </div>
          )}
          <ComposerInput
            ref={inputHandleRef}
            textareaRef={textareaRef}
            activeCapabilityKey={activeCapabilityKey}
            isMathAnimatorMode={isMathAnimatorMode}
            isVisualizeMode={isVisualizeMode}
            canSendEmpty={hasReferences}
            onSend={doSend}
            onInputChange={handleInputChange}
            onPaste={onPaste}
            selectedCounts={spaceSelectionCounts}
            onSelectNotebookPicker={onSelectNotebookPicker}
            onSelectBookPicker={onSelectBookPicker}
            onSelectHistoryPicker={onSelectHistoryPicker}
            onSelectQuestionBankPicker={onSelectQuestionBankPicker}
            onSelectSkillsPicker={onSelectSkillsPicker}
            onSelectMemoryPicker={onSelectMemoryPicker}
          />

          {!!attachments.length && (
            <div className="flex flex-wrap gap-2 px-4 pb-2">
              {attachments.map((a, i) => {
                const previewLabel = t("Preview");
                const removeLabel = t("Remove attachment");
                if (a.type === "image" && a.previewUrl) {
                  return (
                    <div key={`${a.filename}-${i}`} className="group relative">
                      <button
                        type="button"
                        onClick={() => onPreviewAttachment?.(i)}
                        title={a.filename || previewLabel}
                        aria-label={previewLabel}
                        className="relative block h-16 w-16 overflow-hidden rounded-lg border border-[var(--border)] transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40"
                      >
                        <Image
                          src={a.previewUrl}
                          alt={a.filename || t("Attachment preview")}
                          fill
                          unoptimized
                          className="object-cover"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveAttachment(i);
                        }}
                        aria-label={removeLabel}
                        className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--foreground)] text-[var(--background)] opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  );
                }
                if (isSvgFilename(a.filename) && a.previewUrl) {
                  return (
                    <div
                      key={`${a.filename}-${i}`}
                      className="group relative"
                      title={a.filename}
                    >
                      <button
                        type="button"
                        onClick={() => onPreviewAttachment?.(i)}
                        aria-label={previewLabel}
                        className="relative block h-16 w-16 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40"
                      >
                        {/* Native <img> is safe for SVG: scripts inside an
                            SVG don't execute under <img> context. Next.js
                            <Image> rejects SVG by default. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={a.previewUrl}
                          alt={a.filename || t("Attachment preview")}
                          className="h-full w-full object-contain p-1"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveAttachment(i);
                        }}
                        aria-label={removeLabel}
                        className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--foreground)] text-[var(--background)] opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  );
                }
                const spec = docIconFor(a.filename);
                const Icon = spec.Icon;
                const sizeLabel = a.size ? formatBytes(a.size) : "";
                return (
                  <div
                    key={`${a.filename}-${i}`}
                    className="group relative"
                    title={a.filename}
                  >
                    <button
                      type="button"
                      onClick={() => onPreviewAttachment?.(i)}
                      aria-label={previewLabel}
                      className="flex h-16 w-[160px] items-center gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 text-left transition-colors hover:border-[var(--primary)]/40 hover:bg-[var(--muted)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--muted)]/60">
                        <Icon
                          size={22}
                          strokeWidth={1.5}
                          className={spec.tint}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-[var(--foreground)]">
                          {a.filename}
                        </div>
                        <div className="truncate text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                          {sizeLabel
                            ? `${spec.label} · ${sizeLabel}`
                            : spec.label}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveAttachment(i);
                      }}
                      aria-label={removeLabel}
                      className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--foreground)] text-[var(--background)] opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                    >
                      <X size={10} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {attachmentError && (
            <div className="px-4 pb-2 text-[11px] text-red-600">
              {attachmentError}
            </div>
          )}

          <div className="border-t border-[var(--border)]/35 px-3 py-2">
            <div ref={toolbarRowRef} className="flex items-center gap-2">
              <button
                ref={capBtnRef}
                onClick={() => onSetCapMenuOpen((v) => !v)}
                title={t(activeCap.label)}
                className={`inline-flex shrink-0 items-center gap-1.5 py-1.5 px-1 text-[12px] transition-colors ${
                  capMenuOpen
                    ? "text-[var(--foreground)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                <CapIcon size={14} strokeWidth={1.6} />
                <span className={`font-medium ${toolbarLevel >= 2 ? "hidden" : ""}`}>
                  {t(activeCap.label)}
                </span>
                <ChevronDown
                  size={11}
                  className={`transition-transform ${capMenuOpen ? "rotate-180" : ""}`}
                />
              </button>

              <div className="h-3.5 w-px bg-[var(--border)]/30" />

              <div className="flex min-w-0 flex-1 items-center gap-1">
                {isResearchMode ? (
                  <div className="relative flex items-center gap-0.5">
                    <button
                      ref={toolBtnRef}
                      onClick={() => onSetToolMenuOpen((v) => !v)}
                      title={t("Sources")}
                      className="inline-flex shrink-0 items-center gap-1 py-1 px-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                    >
                      <Layers size={12} strokeWidth={1.7} />
                      <span className={toolbarLevel >= 1 ? "hidden" : ""}>{t("Sources")}</span>
                      <ChevronDown
                        size={10}
                        className={`transition-transform ${toolMenuOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                    {researchConfig.sources.length > 0 && (
                      <div className="flex items-center gap-[3px] overflow-hidden">
                        {researchSources
                          .filter((rs) =>
                            researchConfig.sources.includes(rs.name),
                          )
                          .map((rs, i) => (
                            <span
                              key={rs.name}
                              className="shrink-0 text-[10px] text-[var(--muted-foreground)]/35"
                            >
                              {i > 0 && (
                                <span className="text-[12px] leading-none">
                                  ·
                                </span>
                              )}
                              {t(rs.label)}
                            </span>
                          ))}
                      </div>
                    )}
                    {toolMenuOpen && (
                      <div
                        ref={toolMenuRef}
                        className="absolute bottom-full left-0 z-50 mb-1.5 min-w-[180px] rounded-lg border border-[var(--border)] bg-[var(--popover)] py-1 shadow-lg backdrop-blur-md"
                      >
                        {researchSources.map((source) => {
                          const active = researchConfig.sources.includes(
                            source.name,
                          );
                          const Icon = source.icon;
                          return (
                            <button
                              key={source.name}
                              onClick={() =>
                                onToggleResearchSource(source.name)
                              }
                              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] transition-colors ${
                                active
                                  ? "text-[var(--primary)]"
                                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                              } hover:bg-[var(--muted)]/40`}
                            >
                              <Icon size={13} strokeWidth={1.7} />
                              <span className="flex-1 font-medium">
                                {t(source.label)}
                              </span>
                              {active && (
                                <div className="h-1.5 w-1.5 rounded-full bg-[var(--primary)]" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : visibleTools.length > 0 ? (
                  <div className="relative flex items-center gap-0.5">
                    <button
                      ref={toolBtnRef}
                      onClick={() => onSetToolMenuOpen((v) => !v)}
                      title={t("Tools")}
                      className="inline-flex shrink-0 items-center gap-1 py-1 px-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                    >
                      <Sparkles size={12} strokeWidth={1.7} />
                      <span className={toolbarLevel >= 1 ? "hidden" : ""}>{t("Tools")}</span>
                      <ChevronDown
                        size={10}
                        className={`transition-transform ${toolMenuOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                    {selectedTools.size > 0 && (
                      <div className="flex items-center gap-[3px] overflow-hidden">
                        {visibleTools
                          .filter((vt) => selectedTools.has(vt.name))
                          .map((vt, i) => (
                            <span
                              key={vt.name}
                              className="shrink-0 text-[10px] text-[var(--muted-foreground)]/35"
                            >
                              {i > 0 && (
                                <span className="text-[12px] leading-none">
                                  ·
                                </span>
                              )}
                              {t(vt.label)}
                            </span>
                          ))}
                      </div>
                    )}
                    {toolMenuOpen && (
                      <div
                        ref={toolMenuRef}
                        className="absolute bottom-full left-0 z-50 mb-1.5 min-w-[180px] rounded-lg border border-[var(--border)] bg-[var(--popover)] py-1 shadow-lg backdrop-blur-md"
                      >
                        {visibleTools.map((tool) => {
                          const active = selectedTools.has(tool.name);
                          const Icon = tool.icon;
                          return (
                            <button
                              key={tool.name}
                              onClick={() => onToggleTool(tool.name)}
                              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] transition-colors ${
                                active
                                  ? "text-[var(--primary)]"
                                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                              } hover:bg-[var(--muted)]/40`}
                            >
                              <Icon size={13} strokeWidth={1.7} />
                              <span className="flex-1 font-medium">
                                {t(tool.label)}
                              </span>
                              {active && (
                                <div className="h-1.5 w-1.5 rounded-full bg-[var(--primary)]" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={handlePickFiles}
                  title={t("Attach files")}
                  aria-label={t("Attach files")}
                  className="inline-flex shrink-0 items-center gap-1 py-1 px-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                >
                  <Paperclip size={12} strokeWidth={1.7} />
                  <span className={toolbarLevel >= 1 ? "hidden" : ""}>{t("Attach")}</span>
                </button>

                <div className="relative flex items-center gap-0.5">
                  <button
                    ref={spaceBtnRef}
                    type="button"
                    onClick={() => onSetSpaceMenuOpen((v) => !v)}
                    title={t("Space")}
                    className="inline-flex shrink-0 items-center gap-1 py-1 px-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                  >
                    <AtSign size={12} strokeWidth={1.7} />
                    <span className={toolbarLevel >= 1 ? "hidden" : ""}>{t("Space")}</span>
                    <ChevronDown
                      size={10}
                      className={`transition-transform ${spaceMenuOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {spaceSelectionCount > 0 && (
                    <span className="shrink-0 rounded-full bg-[var(--primary)]/10 px-1.5 py-px text-[9px] font-semibold text-[var(--primary)]">
                      {spaceSelectionCount}
                    </span>
                  )}
                  {spaceMenuOpen && (
                    <div
                      ref={spaceMenuRef}
                      className="absolute bottom-full left-0 z-50 mb-1.5"
                    >
                      <ChatSpaceMenu
                        variant="toolbar"
                        selectedCounts={spaceSelectionCounts}
                        onSelectItem={(key) => {
                          onSetSpaceMenuOpen(false);
                          if (key === "chat_history") onSelectHistoryPicker();
                          else if (key === "books") onSelectBookPicker();
                          else if (key === "notebooks")
                            onSelectNotebookPicker();
                          else if (key === "question_bank")
                            onSelectQuestionBankPicker();
                          else if (key === "skills") onSelectSkillsPicker();
                          else if (key === "memory") onSelectMemoryPicker();
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                <ModelSelector
                  options={llmOptions}
                  activeDefault={activeLLMDefault}
                  value={llmSelection}
                  loading={llmOptionsLoading}
                  error={llmOptionsError}
                  onChange={onSelectLLM}
                />

                <div className="relative flex items-center gap-0.5">
                  <button
                    ref={kbBtnRef}
                    type="button"
                    onClick={() =>
                      ragActive ? onSetKbMenuOpen((v) => !v) : undefined
                    }
                    disabled={!ragActive}
                    title={t("KB")}
                    className={`inline-flex shrink-0 items-center gap-1 py-1 px-1.5 text-[11px] font-medium transition-colors ${
                      ragActive
                        ? "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                        : "cursor-not-allowed text-[var(--border)]"
                    }`}
                  >
                    <Database size={12} strokeWidth={1.7} />
                    <span className={toolbarLevel >= 2 ? "hidden" : ""}>{t("KB")}</span>
                    <ChevronDown
                      size={10}
                      className={`transition-transform ${kbMenuOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {stateKnowledgeBases.length > 0 && (
                    <span className="shrink-0 rounded-full bg-[var(--primary)]/10 px-1.5 py-px text-[9px] font-semibold text-[var(--primary)]">
                      {stateKnowledgeBases.length}
                    </span>
                  )}
                  {kbMenuOpen && (
                    <div
                      ref={kbMenuRef}
                      className="absolute bottom-full right-0 z-50 mb-1.5 min-w-[200px] max-w-[260px] rounded-lg border border-[var(--border)] bg-[var(--popover)] py-1 shadow-lg backdrop-blur-md"
                    >
                      {knowledgeBases.length === 0 ? (
                        <div className="px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
                          {t("No knowledge bases available")}
                        </div>
                      ) : (
                        knowledgeBases.map((kb) => {
                          const active = stateKnowledgeBases.includes(kb.name);
                          return (
                            <button
                              key={kb.name}
                              type="button"
                              onClick={() => onToggleKB(kb.name)}
                              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-[var(--muted)]/40 ${
                                active
                                  ? "text-[var(--primary)]"
                                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                              }`}
                            >
                              <span
                                className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
                                  active
                                    ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                                    : "border-[var(--border)]"
                                }`}
                              >
                                {active && (
                                  <svg
                                    width="8"
                                    height="8"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                  >
                                    <path d="M20 6L9 17l-5-5" />
                                  </svg>
                                )}
                              </span>
                              <span className="flex-1 truncate font-medium">
                                {kb.name}
                              </span>
                              {active && (
                                <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--primary)]" />
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                {isStreaming ? (
                  <button
                    type="button"
                    onClick={onCancelStreaming}
                    className="group relative inline-flex h-[29px] w-[29px] shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-white shadow-[0_4px_12px_rgba(195,90,44,0.18)] transition-[background-color,box-shadow] hover:bg-[var(--primary)]/90 hover:shadow-[0_6px_16px_rgba(195,90,44,0.28)]"
                    aria-label={t("Stop generating")}
                    title={t("Stop generating")}
                  >
                    {/* A faint ring slowly rotates around the rim while
                        streaming, signalling "still working — click to
                        cancel". The white square sits front-and-center so
                        the click target is always obvious. */}
                    <span className="pointer-events-none absolute inset-0 rounded-full border-[1.5px] border-white/30 border-t-white/85 animate-spin opacity-90 transition-opacity group-hover:opacity-40" />
                    <Square
                      size={9}
                      strokeWidth={2.6}
                      className="relative z-10 fill-current"
                    />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleManualSend}
                    disabled={!canSend}
                    className="rounded-full bg-[var(--primary)] p-[7px] text-white shadow-[0_4px_12px_rgba(195,90,44,0.15)] transition-[transform,opacity,box-shadow] hover:shadow-[0_6px_16px_rgba(195,90,44,0.22)] disabled:opacity-25 disabled:shadow-none"
                    aria-label={t("Send")}
                  >
                    <ArrowUp size={15} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {(isQuizMode ||
            isMathAnimatorMode ||
            isVisualizeMode ||
            isResearchMode) && (
            <div className="border-t border-[var(--border)]/15">
              {isQuizMode ? (
                <QuizConfigPanel
                  value={quizConfig}
                  onChange={onChangeQuizConfig}
                  uploadedPdf={quizPdf}
                  onUploadPdf={onUploadQuizPdf}
                  collapsed={panelCollapsed}
                  onToggleCollapsed={onTogglePanelCollapsed}
                />
              ) : isMathAnimatorMode ? (
                <MathAnimatorConfigPanel
                  value={mathAnimatorConfig}
                  onChange={onChangeMathAnimatorConfig}
                  collapsed={panelCollapsed}
                  onToggleCollapsed={onTogglePanelCollapsed}
                />
              ) : isVisualizeMode ? (
                <VisualizeConfigPanel
                  value={visualizeConfig}
                  onChange={onChangeVisualizeConfig}
                  collapsed={panelCollapsed}
                  onToggleCollapsed={onTogglePanelCollapsed}
                />
              ) : (
                <ResearchConfigPanel
                  value={researchConfig}
                  errors={researchValidationErrors}
                  collapsed={panelCollapsed}
                  onChange={onChangeResearchConfig}
                  onToggleCollapsed={onTogglePanelCollapsed}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
