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
  BookOpen,
  ChevronDown,
  Database,
  Layers,
  Paperclip,
  Plus,
  Sparkles,
  Square,
  X,
  Zap,
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
import ChatSpaceMenu, {
  type SelectableSpaceKey,
} from "@/components/chat/space/ChatSpaceMenu";
import type { SpaceMemoryFile } from "@/lib/space-items";
import { SPACE_ITEMS } from "@/lib/space-items";
import PromptBarSparks from "@/components/ui/PromptBarSparks";
import type { SelectedBookReference } from "@/lib/book-references";
import ModelSelector from "./ModelSelector";
import GooeyButton from "./GooeyButton";

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
  spaceKeys,
  plusMenuOpen,
  plusMenuRef,
  plusBtnRef,
  onSetPlusMenuOpen,
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
  fastMode,
  onToggleFastMode,
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
  /** 「空间」@ 引用菜单可见项；现在收编进加号菜单（财问裁剪） */
  spaceKeys: SelectableSpaceKey[];
  /** 左端加号（统一来源菜单）的开关与定位 ref */
  plusMenuOpen: boolean;
  plusMenuRef: RefObject<HTMLDivElement | null>;
  plusBtnRef: RefObject<HTMLButtonElement | null>;
  onSetPlusMenuOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
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
  /** 快速模式（仅 chat 能力下显示）：勾选后知识库问答走快路径，跳过思考/观察阶段。 */
  fastMode: boolean;
  onToggleFastMode: () => void;
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
  /* 加号菜单的跟随高亮（React Bits PromptBar plus 菜单同款）：记录鼠标所在
   * 行的真实 offsetTop/Height，灰色圆角块平滑滑过去。行数随角色变化
   * （普通用户 2 行、管理员 3 行）且行高受 i18n 影响，所以不用 CSS 写死
   * nth-child 位移；mouseenter 时读一次布局，不是每帧算，开销可忽略。 */
  const [plusHover, setPlusHover] = useState<{
    top: number;
    height: number;
  } | null>(null);
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

  /* 加号菜单行 mouseenter：读一次该行的真实位置驱动高亮块滑动 */
  const handlePlusRowEnter = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    setPlusHover({ top: el.offsetTop, height: el.offsetHeight });
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

  /* 联网搜索是开关型工具：开启后像 space 引用一样在输入框上方显示胶囊，
     学生一眼能看到「这条回答会联网」，点 × 即关 */
  const webSearchOn = selectedTools.has("web_search");

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

  /* 加号菜单里的「空间引用」行：按 spaceKeys 生成（普通用户为空数组 →
     整段不渲染；管理员只有 memory）。恢复其它空间项只要改 lib/features.ts
     的 ENABLED_SPACE_KEYS，这里不用动。 */
  const spaceRows = spaceKeys
    .map((key) => {
      if (key === "memory")
        return {
          key,
          label: "Memory",
          description: "Long-form memory the assistant carries across sessions.",
          icon: SPACE_ITEMS.find((it) => it.key === "memory")!.icon,
          run: onSelectMemoryPicker,
        } as const;
      if (key === "books")
        return {
          key,
          label: "Books",
          description: "Reference generated book chapters in chat.",
          icon: BookOpen,
          run: onSelectBookPicker,
        } as const;
      const item = SPACE_ITEMS.find((it) => it.key === key);
      if (!item) return null;
      const runners: Record<string, () => void> = {
        chat_history: onSelectHistoryPicker,
        notebooks: onSelectNotebookPicker,
        question_bank: onSelectQuestionBankPicker,
        skills: onSelectSkillsPicker,
      };
      return {
        key,
        label: item.label,
        description: item.description,
        icon: item.icon,
        run: runners[key] ?? onSelectMemoryPicker,
      } as const;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

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
          className={`relative rounded-2xl border bg-[var(--card)] shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_24px_-8px_rgba(0,0,0,0.08)] transition-[border-color,box-shadow] duration-200 focus-within:shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_28px_-6px_rgba(0,0,0,0.11)] ${
            dragging
              ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_3%,transparent)]"
              : "border-[var(--border)] focus-within:border-[color-mix(in_srgb,var(--primary)_35%,transparent)]"
          }`}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          data-drag-counter={dragCounter.current}
        >
          {/* 快速模式开启 = 走快路径：铺一层上升粒子作为状态反馈（React Bits
              PromptBar 移植件）。关闭即卸载，不留在后台；
              prefers-reduced-motion 下组件内部直接不渲染。 */}
          {fastMode && (
            <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-2xl">
              {/* PromptBar 原版同款：左下角径向渐变光晕，与粒子同现（globals.css） */}
              <div className="dt-composer-glow absolute inset-0" />
              <PromptBarSparks />
            </div>
          )}

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

          {(hasReferences || webSearchOn) && (
            <div className="px-4 pt-3.5 [&>div]:mb-0">
              <SpaceContextChips
                webSearchOn={webSearchOn}
                onToggleWebSearch={() => onToggleTool("web_search")}
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
            spaceKeys={spaceKeys}
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

          {/* ChatGPT/Doubao 式：工具栏与输入区之间不画线，只靠留白分区 */}
          <div className="px-3 pb-2.5 pt-1.5">
            <div ref={toolbarRowRef} className="flex items-center gap-2">
              {/* 只剩 Chat 一个能力时（普通用户，见 lib/features.ts）整个选择器
                  收掉——产品定位就是「进来直接问」，不挑模式。 */}
              {capabilities.length > 1 && (
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
              )}

              {capabilities.length > 1 && (
                <div className="h-3.5 w-px bg-[var(--border)]/30" />
              )}

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
                ) : null}

                {/* 财问输入区左端：加号 = 统一来源菜单（React Bits PromptBar
                    的 plus 菜单形态，图标 + 名称 + 描述）。
                    原先的「工具」「附件」「空间」三个独立按钮全部收编到这里
                    —— 跟 ChatGPT / Claude 一致：左侧一个 +，右侧是模型/知识库/
                    发送。菜单项随 lib/features.ts 的开关自动增减。 */}
                <div className="relative flex items-center">
                  <button
                    ref={plusBtnRef}
                    type="button"
                    onClick={() => {
                      onSetPlusMenuOpen((v) => !v);
                      setPlusHover(null); // 重开菜单时不残留上次的 hover 块
                    }}
                    title={t("Add")}
                    aria-label={t("Add")}
                    className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors ${
                      plusMenuOpen
                        ? "border-[var(--primary)]/40 bg-[var(--primary)]/10 text-[var(--primary)]"
                        : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]/40 hover:text-[var(--foreground)]"
                    }`}
                  >
                    <Plus size={14} strokeWidth={2} />
                  </button>
                  {plusMenuOpen && (
                    <div
                      ref={plusMenuRef}
                      onMouseLeave={() => setPlusHover(null)}
                      className="dt-pop absolute bottom-full left-0 z-50 mb-2 w-[252px] rounded-xl border border-[var(--border)] bg-[var(--popover)] py-1.5 shadow-lg backdrop-blur-md"
                    >
                      {/* 跟随高亮块：鼠标所在行亮起，行间平滑滑动，离开菜单淡出。
                          行的 hover:bg 已去掉，避免「块在滑 + 行在闪」双重反馈；
                          选中色只留给联网搜索（开关态）。
                          两个坑：① 半透明**不能**写成 bg-[var(--muted)]/50 ——
                          Tailwind v3 对「CSS 变量 + /透明度」不生成任何规则
                          （--muted 是十六进制 #ece7dd，v3 解析不了就直接跳过），
                          所以这里用实心 bg + inline opacity；② 必须显式 top-0，
                          否则 absolute 块落在静态位置（容器 padding 之后）会整体
                          下移；③ 加 -z-10，让块压在行文字下面而不是盖住文字。 */}
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-1.5 top-0 -z-10 rounded-lg bg-[var(--muted)] transition-[transform,opacity] duration-150 ease-out"
                        style={{
                          transform: `translateY(${(plusHover?.top ?? 0) + 3}px)`,
                          height: (plusHover?.height ?? 0) - 6,
                          opacity: plusHover ? 0.55 : 0,
                        }}
                      />

                      {/* 1. 上传文件：沿用原附件按钮的流程 */}
                      <button
                        type="button"
                        onClick={() => {
                          onSetPlusMenuOpen(false);
                          handlePickFiles();
                        }}
                        onMouseEnter={handlePlusRowEnter}
                        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left"
                      >
                        <Paperclip
                          size={13}
                          strokeWidth={1.7}
                          className="shrink-0 text-[var(--muted-foreground)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium text-[var(--foreground)]">
                            {t("Attach files")}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-[var(--muted-foreground)]">
                            {t("Add images or documents from this device")}
                          </span>
                        </span>
                      </button>

                      {/* 2. 可开关的工具（只有联网搜索；已开启显示红点） */}
                      {visibleTools.map((tool) => {
                        const active = selectedTools.has(tool.name);
                        const Icon = tool.icon;
                        return (
                          <button
                            key={tool.name}
                            type="button"
                            onClick={() => onToggleTool(tool.name)}
                            onMouseEnter={handlePlusRowEnter}
                            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left"
                          >
                            <Icon
                              size={13}
                              strokeWidth={1.7}
                              className={`shrink-0 ${
                                active
                                  ? "text-[var(--primary)]"
                                  : "text-[var(--muted-foreground)]"
                              }`}
                            />
                            <span className="min-w-0 flex-1">
                              <span
                                className={`block truncate text-[12px] font-medium ${
                                  active
                                    ? "text-[var(--primary)]"
                                    : "text-[var(--foreground)]"
                                }`}
                              >
                                {t(tool.label)}
                              </span>
                              <span className="mt-0.5 block truncate text-[11px] text-[var(--muted-foreground)]">
                                {t("Search the web for up-to-date answers")}
                              </span>
                            </span>
                            {active && (
                              <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--primary)]" />
                            )}
                          </button>
                        );
                      })}

                      {/* 3. 空间引用（普通用户为空，管理员只有记忆） */}
                      {spaceRows.map((row) => (
                        <button
                          key={row.key}
                          type="button"
                          onClick={() => {
                            onSetPlusMenuOpen(false);
                            row.run();
                          }}
                          onMouseEnter={handlePlusRowEnter}
                          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left"
                        >
                          <row.icon
                            size={13}
                            strokeWidth={1.7}
                            className="shrink-0 text-[var(--muted-foreground)]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-medium text-[var(--foreground)]">
                              {t(row.label)}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-[var(--muted-foreground)]">
                              {t(row.description)}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {activeCapabilityKey === "chat" && (
                  <GooeyButton
                    active={fastMode}
                    onToggle={onToggleFastMode}
                    label="快速回答"
                    title="快速回答：跳过思考与观察阶段、直接检索作答，响应更快但检索可能不够全面；再次点击取消，走完整链路"
                    icon={<Zap size={12} strokeWidth={1.8} />}
                    compact={toolbarLevel >= 2}
                  />
                )}
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
                      className="dt-pop dt-pop-right absolute bottom-full right-0 z-50 mb-1.5 min-w-[200px] max-w-[260px] rounded-lg border border-[var(--border)] bg-[var(--popover)] py-1 shadow-lg backdrop-blur-md"
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
