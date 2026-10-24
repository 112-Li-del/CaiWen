"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import {
  BarChart3,
  BrainCircuit,
  Clapperboard,
  Code2,
  Database,
  FileSearch,
  Globe,
  Lightbulb,
  MessageSquare,
  Microscope,
  PenLine,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SelectedRecord } from "@/lib/notebook-selection-types";
import type { SelectedHistorySession } from "@/components/chat/HistorySessionPicker";
import type { SelectedQuestionEntry } from "@/components/chat/QuestionBankPicker";
import ChatComposer from "@/components/chat/home/ChatComposer";
import SplitText from "@/components/ui/SplitText";
import GlitchPromptTitle from "@/components/chat/home/GlitchPromptTitle";
import { ChatMessageList } from "@/components/chat/home/ChatMessages";
import EmotionBall, { resolveEmotion } from "@/components/chat/EmotionBall";
// Imported eagerly so the drawer shell is always mounted off-screen —
// clicking a chip becomes a single CSS class flip, no chunk fetch + double
// render. The heavy renderers inside still load lazily.
import FilePreviewDrawer from "@/components/chat/preview/FilePreviewDrawer";
import {
  useUnifiedChat,
  type MessageAttachment,
} from "@/context/UnifiedChatContext";
import { useAppShell } from "@/context/AppShellContext";
import type { FilePreviewSource } from "@/components/chat/preview/previewerFor";
import type { LLMSelection } from "@/lib/unified-ws";
import {
  extractBase64FromDataUrl,
  readFileAsDataUrl,
} from "@/lib/file-attachments";
import {
  classifyFile,
  isSvgFilename,
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from "@/lib/doc-attachments";
import { useChatAutoScroll } from "@/hooks/useChatAutoScroll";
import { useMeasuredHeight } from "@/hooks/useMeasuredHeight";
import {
  loadCapabilityPlaygroundConfigs,
  resolveCapabilityPlaygroundConfig,
  type CapabilityPlaygroundConfigMap,
} from "@/lib/playground-config";
import {
  DEFAULT_QUIZ_CONFIG,
  buildQuizWSConfig,
  type DeepQuestionFormConfig,
} from "@/lib/quiz-types";
import {
  DEFAULT_MATH_ANIMATOR_CONFIG,
  buildMathAnimatorWSConfig,
  type MathAnimatorFormConfig,
} from "@/lib/math-animator-types";
import {
  DEFAULT_VISUALIZE_CONFIG,
  buildVisualizeWSConfig,
  type VisualizeFormConfig,
} from "@/lib/visualize-types";
import {
  buildResearchWSConfig,
  createEmptyResearchConfig,
  validateResearchConfig,
  type DeepResearchFormConfig,
  type OutlineItem,
  type ResearchSource,
} from "@/lib/research-types";
import {
  knowledgeBaseFilePath,
  listKnowledgeBases,
} from "@/lib/knowledge-api";
import { fetchAuthStatus, AUTH_ENABLED } from "@/lib/auth";
import {
  HIDDEN_CAPABILITIES,
  MENU_TOOLS,
  ALWAYS_ON_TOOLS,
  ENABLED_SPACE_KEYS,
} from "@/lib/features";
import { listLLMOptions, type LLMOption } from "@/lib/llm-options";
import { downloadChatMarkdown } from "@/lib/chat-export";
import type { SpaceMemoryFile } from "@/lib/space-items";
import {
  selectedBooksToPayload,
  type SelectedBookReference,
} from "@/lib/book-references";

const NotebookRecordPicker = dynamic(
  () => import("@/components/notebook/NotebookRecordPicker"),
  {
    ssr: false,
  },
);
const HistorySessionPicker = dynamic(
  () => import("@/components/chat/HistorySessionPicker"),
  {
    ssr: false,
  },
);
const QuestionBankPicker = dynamic(
  () => import("@/components/chat/QuestionBankPicker"),
  {
    ssr: false,
  },
);
const SkillsPicker = dynamic(() => import("@/components/chat/SkillsPicker"), {
  ssr: false,
});
const MemoryPicker = dynamic(() => import("@/components/chat/MemoryPicker"), {
  ssr: false,
});
const BookReferencePicker = dynamic(
  () => import("@/components/chat/BookReferencePicker"),
  {
    ssr: false,
  },
);
const SaveToNotebookModal = dynamic(
  () => import("@/components/notebook/SaveToNotebookModal"),
  {
    ssr: false,
  },
);

/* ------------------------------------------------------------------ */
/*  Type & data definitions                                           */
/* ------------------------------------------------------------------ */

type ToolName =
  | "brainstorm"
  | "rag"
  | "web_search"
  | "code_execution"
  | "reason"
  | "paper_search";

interface ToolDef {
  name: ToolName;
  label: string;
  icon: LucideIcon;
}

interface ResearchSourceDef {
  name: ResearchSource;
  label: string;
  icon: LucideIcon;
}

const ALL_TOOLS: ToolDef[] = [
  { name: "brainstorm", label: "Brainstorm", icon: Lightbulb },
  { name: "rag", label: "RAG", icon: Database },
  { name: "web_search", label: "Web Search", icon: Globe },
  { name: "code_execution", label: "Code", icon: Code2 },
  { name: "reason", label: "Reason", icon: Sparkles },
  { name: "paper_search", label: "Arxiv Search", icon: FileSearch },
];

const RESEARCH_SOURCES: ResearchSourceDef[] = [
  { name: "kb", label: "Knowledge Base", icon: Database },
  { name: "web", label: "Web", icon: Globe },
  { name: "papers", label: "Papers", icon: FileSearch },
];

interface CapabilityDef {
  value: string;
  label: string;
  description: string;
  icon: LucideIcon;
  allowedTools: ToolName[];
  defaultTools: ToolName[];
}

const CAPABILITIES: CapabilityDef[] = [
  {
    value: "",
    label: "Chat",
    description: "Flexible conversation with any tool",
    icon: MessageSquare,
    allowedTools: [
      "brainstorm",
      "rag",
      "web_search",
      "code_execution",
      "reason",
      "paper_search",
    ],
    defaultTools: ["rag"],
  },
  {
    value: "deep_solve",
    label: "Deep Solve",
    description: "Multi-step reasoning & problem solving",
    icon: BrainCircuit,
    allowedTools: ["rag", "web_search", "code_execution", "reason"],
    defaultTools: ["rag", "web_search", "code_execution", "reason"],
  },
  {
    value: "deep_question",
    label: "Quiz Generation",
    description: "Auto-validated question generation",
    icon: PenLine,
    allowedTools: ["rag", "web_search", "code_execution"],
    defaultTools: ["rag", "web_search", "code_execution"],
  },
  {
    value: "deep_research",
    label: "Deep Research",
    description: "Comprehensive multi-agent research",
    icon: Microscope,
    allowedTools: [],
    defaultTools: [],
  },
  {
    value: "math_animator",
    label: "Math Animator",
    description: "Generate math videos or storyboard images",
    icon: Clapperboard,
    allowedTools: [],
    defaultTools: [],
  },
  {
    value: "visualize",
    label: "Visualize",
    description: "Generate SVG, Chart.js, or Mermaid visualizations",
    icon: BarChart3,
    allowedTools: [],
    defaultTools: [],
  },
];

interface KnowledgeBase {
  name: string;
  is_default?: boolean;
  available?: boolean;
}

interface PendingAttachment {
  type: string;
  filename: string;
  base64?: string;
  previewUrl?: string;
  size?: number;
  mimeType?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function getCapability(value: string | null): CapabilityDef {
  return CAPABILITIES.find((c) => c.value === (value || "")) ?? CAPABILITIES[0];
}

/* ------------------------------------------------------------------ */
/*  Chat page                                                         */
/* ------------------------------------------------------------------ */

export default function ChatPage() {
  const params = useParams<{ sessionId?: string[] }>();
  const router = useRouter();
  const { t } = useTranslation();
  const sessionIdParam = params.sessionId?.[0] ?? null;
  const { setActiveSessionId, language: appLanguage } = useAppShell();

  const {
    state,
    setTools,
    setCapability,
    setKBs,
    setLLMSelection,
    sendMessage,
    cancelStreamingTurn,
    regenerateLastMessage,
    newSession,
    loadSession,
  } = useUnifiedChat();

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [llmOptions, setLLMOptions] = useState<LLMOption[]>([]);
  const [activeLLMDefault, setActiveLLMDefault] = useState<LLMSelection | null>(
    null,
  );
  const [llmOptionsLoading, setLLMOptionsLoading] = useState(true);
  const [llmOptionsError, setLLMOptionsError] = useState(false);
  const [capabilityConfigs, setCapabilityConfigs] =
    useState<CapabilityPlaygroundConfigMap>({});
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [previewSource, setPreviewSource] = useState<FilePreviewSource | null>(
    null,
  );
  const attachmentErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [capMenuOpen, setCapMenuOpen] = useState(false);
  const [quizConfig, setQuizConfig] = useState<DeepQuestionFormConfig>({
    ...DEFAULT_QUIZ_CONFIG,
  });
  const [quizPdf, setQuizPdf] = useState<File | null>(null);
  const [mathAnimatorConfig, setMathAnimatorConfig] =
    useState<MathAnimatorFormConfig>({
      ...DEFAULT_MATH_ANIMATOR_CONFIG,
    });
  const [visualizeConfig, setVisualizeConfig] = useState<VisualizeFormConfig>({
    ...DEFAULT_VISUALIZE_CONFIG,
  });
  const [researchConfig, setResearchConfig] = useState<DeepResearchFormConfig>(
    createEmptyResearchConfig(),
  );
  // Unified collapse state for the capability-specific config panel
  // (Quiz / Math Animator / Visualize / Deep Research). Default collapsed so
  // a fresh Chat / Deep Solve session has the shortest possible composer.
  const [panelCollapsed, setPanelCollapsed] = useState(true);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showNotebookPicker, setShowNotebookPicker] = useState(false);
  const [showBookPicker, setShowBookPicker] = useState(false);
  const [showHistoryPicker, setShowHistoryPicker] = useState(false);
  const [showQuestionBankPicker, setShowQuestionBankPicker] = useState(false);
  const [showSkillsPicker, setShowSkillsPicker] = useState(false);
  const [showMemoryPicker, setShowMemoryPicker] = useState(false);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [spaceMenuOpen, setSpaceMenuOpen] = useState(false);
  /* 左端加号（统一来源菜单：上传/联网搜索/空间引用） */
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [kbMenuOpen, setKbMenuOpen] = useState(false);
  const [selectedNotebookRecords, setSelectedNotebookRecords] = useState<
    SelectedRecord[]
  >([]);
  const [selectedBookReferences, setSelectedBookReferences] = useState<
    SelectedBookReference[]
  >([]);
  const [selectedHistorySessions, setSelectedHistorySessions] = useState<
    SelectedHistorySession[]
  >([]);
  const [selectedQuestionEntries, setSelectedQuestionEntries] = useState<
    SelectedQuestionEntry[]
  >([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [skillsAutoMode, setSkillsAutoMode] = useState(false);
  // 快速模式开关：勾选后知识库问答走快路径（跳过思考/观察，检索可能不全面）。
  // 默认关闭 = 完整链路；偏好记在 localStorage，刷新后保留。
  const [fastMode, setFastMode] = useState<boolean>(false);
  useEffect(() => {
    try {
      setFastMode(window.localStorage.getItem("deeptutor-fast-mode") === "1");
    } catch {
      setFastMode(false);
    }
  }, []);
  const toggleFastMode = useCallback(() => {
    setFastMode((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("deeptutor-fast-mode", next ? "1" : "0");
      } catch {
        // localStorage unavailable (private mode etc.) — keep in-memory state.
      }
      return next;
    });
  }, []);
  const [selectedMemoryFiles, setSelectedMemoryFiles] = useState<
    SpaceMemoryFile[]
  >([]);
  const dragCounter = useRef(0);
  const capMenuRef = useRef<HTMLDivElement>(null);
  const capBtnRef = useRef<HTMLButtonElement>(null);
  const toolMenuRef = useRef<HTMLDivElement>(null);
  const toolBtnRef = useRef<HTMLButtonElement>(null);
  const spaceMenuRef = useRef<HTMLDivElement>(null);
  const spaceBtnRef = useRef<HTMLButtonElement>(null);
  const kbMenuRef = useRef<HTMLDivElement>(null);
  const kbBtnRef = useRef<HTMLButtonElement>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const initialLoadRef = useRef(false);
  const kbInitialAutoSelectDoneRef = useRef(false);
  // null = role not yet resolved; drives KB default-selection per role.
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  // 「收入口不删码」（lib/features.ts）：普通用户只留 Chat + rag/web_search。
  // AUTH 关闭（本地单用户）视为管理员，全量开放，避免本地开发被收。
  const showAllFeatures = !AUTH_ENABLED || isAdmin !== false;

  const activeCap = useMemo(
    () => getCapability(state.activeCapability),
    [state.activeCapability],
  );
  const isQuizMode = activeCap.value === "deep_question";
  const isMathAnimatorMode = activeCap.value === "math_animator";
  const isVisualizeMode = activeCap.value === "visualize";
  const isResearchMode = activeCap.value === "deep_research";
  const selectedTools = useMemo(
    () => new Set(state.enabledTools),
    [state.enabledTools],
  );
  const ragActive = isResearchMode
    ? researchConfig.sources.includes("kb")
    : selectedTools.has("rag");
  const hasMessages = state.messages.length > 0;
  const { ref: composerRef, height: composerHeight } =
    useMeasuredHeight<HTMLDivElement>();
  const visibleTools = useMemo(
    () =>
      ALL_TOOLS.filter(
        (t) =>
          activeCap.allowedTools.includes(t.name) &&
          (MENU_TOOLS as readonly string[]).includes(t.name),
      ),
    [activeCap.allowedTools],
  );
  /* 能力选择器对所有角色都只剩 Chat（HIDDEN_CAPABILITIES 无差别生效，
     2026-10-06 二次裁剪），选择器按钮因仅剩一项而自动隐藏。 */
  const visibleCapabilities = useMemo(
    () =>
      CAPABILITIES.filter((c) => !HIDDEN_CAPABILITIES.has(c.value)),
    [],
  );
  /* 「空间」@ 引用菜单：普通用户整个隐藏（空数组 → ChatComposer 不渲染
     空间按钮、ComposerInput 不响应 @），管理员只留 memory。
     见 lib/features.ts 的 ENABLED_SPACE_KEYS 注释。 */
  const visibleSpaceKeys = useMemo(
    () => (showAllFeatures ? [...ENABLED_SPACE_KEYS] : []),
    [showAllFeatures],
  );
  const researchValidation = useMemo(
    () => validateResearchConfig(researchConfig),
    [researchConfig],
  );
  const notebookReferenceGroups = useMemo(() => {
    const groups = new Map<string, { notebookName: string; count: number }>();
    selectedNotebookRecords.forEach((record) => {
      const existing = groups.get(record.notebookId);
      if (existing) {
        existing.count += 1;
      } else {
        groups.set(record.notebookId, {
          notebookName: record.notebookName,
          count: 1,
        });
      }
    });
    return Array.from(groups.entries()).map(([notebookId, value]) => ({
      notebookId,
      ...value,
    }));
  }, [selectedNotebookRecords]);
  const notebookReferencesPayload = useMemo(() => {
    const grouped = new Map<string, string[]>();
    selectedNotebookRecords.forEach((record) => {
      const current = grouped.get(record.notebookId) || [];
      current.push(record.id);
      grouped.set(record.notebookId, current);
    });
    return Array.from(grouped.entries()).map(([notebook_id, record_ids]) => ({
      notebook_id,
      record_ids,
    }));
  }, [selectedNotebookRecords]);
  const bookReferencesPayload = useMemo(
    () => selectedBooksToPayload(selectedBookReferences),
    [selectedBookReferences],
  );
  const historyReferencesPayload = useMemo(
    () => selectedHistorySessions.map((session) => session.sessionId),
    [selectedHistorySessions],
  );
  const questionNotebookReferencesPayload = useMemo(
    () => selectedQuestionEntries.map((entry) => entry.id),
    [selectedQuestionEntries],
  );
  const memoryReferencesPayload = useMemo(
    () => [...selectedMemoryFiles],
    [selectedMemoryFiles],
  );
  const chatSaveMessages = useMemo(
    () =>
      state.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        capability: msg.capability,
      })),
    [state.messages],
  );
  const chatSavePayload = useMemo(() => {
    if (!state.messages.length) return null;
    const title =
      state.messages
        .find((msg) => msg.role === "user")
        ?.content.trim()
        .slice(0, 80) || "Chat Session";
    return {
      recordType: "chat" as const,
      title,
      // The actual transcript / userQuery are rebuilt inside SaveToNotebookModal
      // from the user's selected subset of messages. We still provide a
      // sensible fallback for non-selection callers.
      userQuery: "",
      output: "",
      metadata: {
        source: "chat",
        capability: state.activeCapability || "chat",
        ui_language: state.language,
        session_id: state.sessionId,
        total_message_count: state.messages.length,
      },
    };
  }, [state.activeCapability, state.language, state.messages, state.sessionId]);
  const lastMessage = state.messages[state.messages.length - 1];
  const {
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    shouldAutoScrollRef,
    handleScroll: handleMessagesScroll,
  } = useChatAutoScroll({
    hasMessages,
    isStreaming: state.isStreaming,
    composerHeight,
    messageCount: state.messages.length,
    lastMessageContent: lastMessage?.content,
    lastEventCount: lastMessage?.events?.length,
  });
  const copyAssistantMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;
    try {
      await navigator.clipboard.writeText(content);
    } catch (error) {
      console.error("Failed to copy assistant message:", error);
    }
  }, []);

  /* ---- URL-driven session loading ---- */
  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;
    if (sessionIdParam) {
      void loadSession(sessionIdParam).catch(() => {
        router.replace("/chat", { scroll: false });
      });
    } else {
      newSession();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // For new users with no stored playground capability config, enable the
  // knowledge-base (RAG) tool by default once KBs are loaded — but only if
  // the user actually has knowledge bases available (e.g. granted by admin).
  // Existing users' stored tool selections are preserved and never overwritten.
  useEffect(() => {
    if (!knowledgeBases.length) return;
    const stored = loadCapabilityPlaygroundConfigs();
    if (Object.keys(stored).length === 0 && !state.enabledTools.length) {
      setTools(["rag"]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knowledgeBases.length]);

  // When URL param changes (sidebar navigation), load the corresponding session
  const prevSessionIdParam = useRef(sessionIdParam);
  useEffect(() => {
    if (sessionIdParam === prevSessionIdParam.current) return;
    prevSessionIdParam.current = sessionIdParam;
    if (sessionIdParam) {
      if (sessionIdParam === state.sessionId) return;
      void loadSession(sessionIdParam).catch(() => {
        router.replace("/chat", { scroll: false });
      });
    } else {
      newSession();
    }
  }, [sessionIdParam, loadSession, newSession, router, state.sessionId]);

  // When a new session_id is assigned by the server, update the URL
  useEffect(() => {
    if (state.sessionId && !sessionIdParam) {
      router.replace(`/chat/${state.sessionId}`, { scroll: false });
    }
  }, [state.sessionId, sessionIdParam, router]);

  useEffect(() => {
    setActiveSessionId(state.sessionId || sessionIdParam || null);
  }, [state.sessionId, sessionIdParam, setActiveSessionId]);

  const refreshKnowledgeBases = useCallback(
    async (options?: { force?: boolean }) => {
      try {
        const list = await listKnowledgeBases({ force: options?.force });
        setKnowledgeBases(list);
        if (
          isAdmin !== null &&
          !kbInitialAutoSelectDoneRef.current &&
          !state.knowledgeBases.length &&
          list.length
        ) {
          kbInitialAutoSelectDoneRef.current = true;
          if (isAdmin) {
            // Admins keep the original behaviour: select the default KB when one
            // is configured.
            const def = list.find((k: KnowledgeBase) => k.is_default);
            if (def?.name) {
              setKBs([def.name]);
            }
          } else {
            // Normal users: default-check the first available KB so a newly
            // approved account immediately has a knowledge base selected. The
            // selection stays fully manual afterwards.
            const firstAvailable = list.find(
              (k: KnowledgeBase) => k.available !== false,
            );
            if (firstAvailable?.name) {
              setKBs([firstAvailable.name]);
            }
          }
        }
      } catch {
        setKnowledgeBases([]);
      }
    },
    [isAdmin, setKBs],
  );

  /* Resolve the current user's role once, so the KB default-selection below
     can behave differently for admins vs normal users. */
  useEffect(() => {
    fetchAuthStatus().then((status) => {
      if (status) setIsAdmin(status.role === "admin");
    });
  }, []);

  /* 残留了被隐藏能力的选中态（持久化在会话状态里）时强制回落到 Chat，
     避免选择器隐藏后仍停留在 deep_solve 等模式下提问。对所有角色生效。 */
  useEffect(() => {
    if (HIDDEN_CAPABILITIES.has(state.activeCapability ?? "")) {
      setCapability(null);
    }
  }, [state.activeCapability, setCapability]);

  /* Load KBs */
  useEffect(() => {
    void refreshKnowledgeBases({ force: true });
  }, [refreshKnowledgeBases]);

  const refreshLLMOptions = useCallback(async () => {
    setLLMOptionsLoading(true);
    try {
      const payload = await listLLMOptions();
      setLLMOptions(payload.options);
      setActiveLLMDefault(payload.active);
      setLLMOptionsError(false);
    } catch {
      setLLMOptionsError(true);
      setLLMOptions([]);
      setActiveLLMDefault(null);
    } finally {
      setLLMOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshLLMOptions();
  }, [refreshLLMOptions]);

  useEffect(() => {
    if (state.llmSelection || !activeLLMDefault) return;
    setLLMSelection(activeLLMDefault);
  }, [activeLLMDefault, setLLMSelection, state.llmSelection]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => {
      void refreshKnowledgeBases({ force: true });
      void refreshLLMOptions();
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshKnowledgeBases, refreshLLMOptions]);

  useEffect(() => {
    setCapabilityConfigs(loadCapabilityPlaygroundConfigs());
  }, []);

  /* URL query params (capability, tool) */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    const qc = p.get("capability");
    const qt = p.getAll("tool");
    if (qc !== null) handleSelectCapability(qc || "");
    else if (qt.length) {
      const valid = qt.filter((t): t is ToolName =>
        ALL_TOOLS.some((d) => d.name === t),
      );
      if (valid.length) setTools(Array.from(new Set(valid)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        capMenuRef.current &&
        !capMenuRef.current.contains(t) &&
        capBtnRef.current &&
        !capBtnRef.current.contains(t)
      )
        setCapMenuOpen(false);
      if (
        toolMenuRef.current &&
        !toolMenuRef.current.contains(t) &&
        toolBtnRef.current &&
        !toolBtnRef.current.contains(t)
      )
        setToolMenuOpen(false);
      if (
        spaceMenuRef.current &&
        !spaceMenuRef.current.contains(t) &&
        spaceBtnRef.current &&
        !spaceBtnRef.current.contains(t)
      )
        setSpaceMenuOpen(false);
      if (
        kbMenuRef.current &&
        !kbMenuRef.current.contains(t) &&
        kbBtnRef.current &&
        !kbBtnRef.current.contains(t)
      )
        setKbMenuOpen(false);
      if (
        plusMenuRef.current &&
        !plusMenuRef.current.contains(t) &&
        plusBtnRef.current &&
        !plusBtnRef.current.contains(t)
      )
        setPlusMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const allowed = new Set([
      ...visibleTools.map((tool) => tool.name),
      // rag 常开（ALWAYS_ON_TOOLS）：菜单里已无开关，裁剪时不能把它剔出
      // enabledTools，否则知识库检索静默失效
      ...ALWAYS_ON_TOOLS,
    ]);
    const nextTools = state.enabledTools.filter((tool) =>
      allowed.has(tool as ToolName),
    );
    // rag 允许但未启用（如旧持久化状态里被关过）→ 补回，保证检索默认在
    const ragAllowed = activeCap.allowedTools.includes("rag");
    const ragOn = nextTools.includes("rag");
    if (ragAllowed && !ragOn) nextTools.push("rag");
    if (
      nextTools.length !== state.enabledTools.length ||
      (ragAllowed && !ragOn)
    ) {
      setTools(nextTools);
    }
  }, [setTools, state.enabledTools, visibleTools, activeCap.allowedTools]);

  /* ---- handlers ---- */

  const handleSelectCapability = useCallback(
    (value: string) => {
      const cap =
        CAPABILITIES.find((c) => c.value === value) ?? CAPABILITIES[0];
      const storageKey = cap.value || "chat";
      const config = resolveCapabilityPlaygroundConfig(
        capabilityConfigs,
        storageKey,
        cap.defaultTools,
      );
      setCapability(cap.value || null);
      setTools(
        config.enabledTools.length > 0 || capabilityConfigs[storageKey]
          ? [...config.enabledTools]
          : [...cap.defaultTools],
      );
      if (config.enabledTools.includes("rag") && config.knowledgeBase)
        setKBs([config.knowledgeBase]);
      // Default-expand the per-capability settings panel right after a
      // capability switch so users immediately see the form. Sending a
      // message later will auto-collapse it (see handleSend).
      setPanelCollapsed(false);
      setCapMenuOpen(false);
    },
    [capabilityConfigs, setCapability, setKBs, setTools],
  );

  const toggleTool = useCallback(
    (tool: string) => {
      if (!activeCap.allowedTools.includes(tool as ToolName)) return;
      if (selectedTools.has(tool)) {
        setTools(state.enabledTools.filter((t) => t !== tool));
      } else {
        setTools([...state.enabledTools, tool]);
      }
    },
    [activeCap.allowedTools, selectedTools, setTools, state.enabledTools],
  );

  const toggleResearchSource = useCallback((source: ResearchSource) => {
    setResearchConfig((current) => ({
      ...current,
      sources: current.sources.includes(source)
        ? current.sources.filter((item) => item !== source)
        : [...current.sources, source],
    }));
  }, []);

  const fileToAttachment = useCallback(
    (f: File): Promise<PendingAttachment> =>
      new Promise((resolve, reject) => {
        readFileAsDataUrl(f)
          .then((raw) => {
            // SVG: treat as file (text extraction on server, vision models
            // reject SVG) but keep the data URL so the chip can render a
            // thumbnail via a raw <img> tag.
            const svg = isSvgFilename(f.name) || f.type === "image/svg+xml";
            const isImage = !svg && f.type.startsWith("image/");
            const b64 = extractBase64FromDataUrl(raw);
            resolve({
              type: isImage ? "image" : "file",
              filename: f.name,
              base64: b64,
              previewUrl: isImage || svg ? raw : undefined,
              size: f.size,
              mimeType: f.type || undefined,
            });
          })
          .catch(reject);
      }),
    [],
  );

  const showAttachmentError = useCallback((message: string) => {
    setAttachmentError(message);
    if (attachmentErrorTimer.current) {
      clearTimeout(attachmentErrorTimer.current);
    }
    attachmentErrorTimer.current = setTimeout(() => {
      setAttachmentError(null);
      attachmentErrorTimer.current = null;
    }, 4000);
  }, []);

  const filterAndReportFiles = useCallback(
    (files: File[]): File[] => {
      let runningTotal = attachments.reduce((s, a) => s + (a.size ?? 0), 0);
      const accepted: File[] = [];
      const rejected: {
        name: string;
        reason: "unsupported" | "too_large" | "quota";
      }[] = [];
      for (const f of files) {
        const kind = classifyFile(f);
        if (!kind) {
          rejected.push({ name: f.name, reason: "unsupported" });
          continue;
        }
        if (f.size > MAX_ATTACHMENT_BYTES) {
          rejected.push({ name: f.name, reason: "too_large" });
          continue;
        }
        if (runningTotal + f.size > MAX_TOTAL_ATTACHMENT_BYTES) {
          rejected.push({ name: f.name, reason: "quota" });
          break;
        }
        runningTotal += f.size;
        accepted.push(f);
      }
      if (rejected.length) {
        const first = rejected[0];
        let msg: string;
        if (first.reason === "too_large") {
          msg = t("File too large: {{name}}", { name: first.name });
        } else if (first.reason === "quota") {
          msg = t("Too many files, skipped some");
        } else {
          msg = t("Unsupported file type: {{name}}", { name: first.name });
        }
        showAttachmentError(msg);
      }
      return accepted;
    },
    [attachments, showAttachmentError, t],
  );

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent) => {
      const items = Array.from(event.clipboardData.items);
      const files = items
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      const accepted = filterAndReportFiles(files);
      if (!accepted.length) return;
      event.preventDefault();
      const next = await Promise.all(accepted.map(fileToAttachment));
      setAttachments((prev) => [...prev, ...next]);
    },
    [fileToAttachment, filterAndReportFiles],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handlePreviewPendingAttachment = useCallback(
    (index: number) => {
      const a = attachments[index];
      if (!a) return;
      setPreviewSource({
        filename: a.filename,
        mimeType: a.mimeType,
        type: a.type,
        base64: a.base64,
        size: a.size,
      });
    },
    [attachments],
  );

  const handlePreviewMessageAttachment = useCallback((a: MessageAttachment) => {
    setPreviewSource({
      filename: a.filename || "",
      mimeType: a.mime_type,
      type: a.type,
      url: a.url,
      base64: a.base64,
      extractedText: a.extracted_text,
      id: a.id,
    });
  }, []);

  const handlePreviewKnowledgeSource = useCallback(
    (source: Record<string, unknown>) => {
      const kbRef = String(source.kb_ref ?? "").trim();
      const rawName = String(
        source.raw_name ?? source.file_name ?? source.title ?? "",
      ).trim();
      const previewPath = String(source.preview_path ?? "").trim();
      if (!kbRef || !rawName || !previewPath) return;

      const pageValue = Number(source.page);
      const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : null;
      const previewRoute = knowledgeBaseFilePath(kbRef, previewPath);
      setPreviewSource({
        filename: rawName,
        mimeType: String(source.preview_mime || "application/pdf"),
        url: page ? `${previewRoute}#page=${page}` : previewRoute,
        downloadUrl: knowledgeBaseFilePath(kbRef, rawName),
        previewLabel: source.converted_from_docx
          ? "PDF preview converted from DOCX"
          : undefined,
        id: `${kbRef}/${previewPath}/${page || 1}`,
      });
    },
    [],
  );

  const handleClosePreview = useCallback(() => {
    setPreviewSource(null);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes("Files")) setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      dragCounter.current = 0;
      const accepted = filterAndReportFiles(Array.from(e.dataTransfer.files));
      if (!accepted.length) return;
      const next = await Promise.all(accepted.map(fileToAttachment));
      setAttachments((prev) => [...prev, ...next]);
    },
    [fileToAttachment, filterAndReportFiles],
  );

  const handleAddFiles = useCallback(
    async (files: File[]) => {
      const accepted = filterAndReportFiles(files);
      if (!accepted.length) return;
      const next = await Promise.all(accepted.map(fileToAttachment));
      setAttachments((prev) => [...prev, ...next]);
    },
    [fileToAttachment, filterAndReportFiles],
  );

  const handleSend = useCallback(
    async (content: string) => {
      if (
        (!content &&
          !attachments.length &&
          !selectedBookReferences.length &&
          !selectedNotebookRecords.length &&
          !selectedHistorySessions.length &&
          !selectedQuestionEntries.length &&
          !selectedSkills.length &&
          !skillsAutoMode &&
          !selectedMemoryFiles.length) ||
        state.isStreaming
      )
        return;

      let extraAttachments = attachments.map((a) => ({
        type: a.type,
        filename: a.filename,
        base64: a.base64,
        mime_type: a.mimeType,
      }));
      let config: Record<string, unknown> | undefined;

      if (isQuizMode) {
        config = buildQuizWSConfig(quizConfig);
        if (quizConfig.mode === "mimic" && quizPdf) {
          const b64 = extractBase64FromDataUrl(
            await readFileAsDataUrl(quizPdf),
          );
          extraAttachments = [
            ...extraAttachments,
            {
              type: "pdf",
              filename: quizPdf.name,
              base64: b64,
              mime_type: "application/pdf",
            },
          ];
        }
      }
      if (isMathAnimatorMode)
        config = buildMathAnimatorWSConfig(mathAnimatorConfig);
      if (isVisualizeMode) config = buildVisualizeWSConfig(visualizeConfig);
      if (isResearchMode) config = buildResearchWSConfig(researchConfig);
      // 快速模式仅对普通 chat 的知识库问答生效；其他能力不读该字段。
      if (fastMode && activeCap.value === "chat") {
        config = { ...(config ?? {}), fast_mode: true };
      }

      const skillsPayload = skillsAutoMode ? ["auto"] : [...selectedSkills];
      const memoryPayload = [...memoryReferencesPayload];
      const messageContent =
        content ||
        (selectedNotebookRecords.length ||
        selectedBookReferences.length ||
        selectedHistorySessions.length ||
        selectedQuestionEntries.length ||
        skillsPayload.length ||
        memoryPayload.length
          ? t("Please use the selected context to help with this request.")
          : "") ||
        (isMathAnimatorMode
          ? attachments.some((a) => a.type === "image")
            ? t(
                "Generate a math animation from the attached reference image(s).",
              )
            : ""
          : attachments.some((a) => a.type === "image")
            ? t("Please analyze the attached image(s).")
            : "");
      sendMessage(
        messageContent,
        extraAttachments,
        config,
        notebookReferencesPayload,
        historyReferencesPayload,
        { bookReferences: bookReferencesPayload },
        questionNotebookReferencesPayload,
        skillsPayload,
        memoryPayload,
      );
      shouldAutoScrollRef.current = true;
      // Auto-collapse the per-capability settings panel after sending so the
      // composer stays compact during conversation.
      setPanelCollapsed(true);
      setAttachments([]);
      setSelectedBookReferences([]);
      setSelectedNotebookRecords([]);
      setSelectedHistorySessions([]);
      setSelectedQuestionEntries([]);
      setSelectedSkills([]);
      setSkillsAutoMode(false);
      setSelectedMemoryFiles([]);
    },
    [
      activeCap.value,
      attachments,
      bookReferencesPayload,
      fastMode,
      historyReferencesPayload,
      isMathAnimatorMode,
      isQuizMode,
      isResearchMode,
      isVisualizeMode,
      mathAnimatorConfig,
      memoryReferencesPayload,
      notebookReferencesPayload,
      questionNotebookReferencesPayload,
      quizConfig,
      quizPdf,
      researchConfig,
      selectedHistorySessions.length,
      selectedMemoryFiles.length,
      selectedBookReferences.length,
      selectedNotebookRecords.length,
      selectedQuestionEntries.length,
      selectedSkills,
      skillsAutoMode,
      sendMessage,
      shouldAutoScrollRef,
      state.isStreaming,
      t,
      visualizeConfig,
    ],
  );

  const handleConfirmOutline = useCallback(
    (
      outline: OutlineItem[],
      _topic: string,
      originalConfig?: Record<string, unknown> | null,
    ) => {
      const config: Record<string, unknown> = {
        ...(originalConfig ?? {
          mode: researchConfig.mode,
          depth: researchConfig.depth,
          sources: [...researchConfig.sources],
        }),
        confirmed_outline: outline,
      };
      sendMessage(_topic, [], config, undefined, undefined, {
        displayUserMessage: false,
        persistUserMessage: false,
      });
      shouldAutoScrollRef.current = true;
    },
    [researchConfig, sendMessage, shouldAutoScrollRef],
  );

  const handleRegenerateMessage = useCallback(() => {
    regenerateLastMessage();
  }, [regenerateLastMessage]);

  const handleToggleKB = useCallback(
    (kb: string) => {
      const current = state.knowledgeBases;
      if (current.includes(kb)) {
        setKBs(current.filter((k) => k !== kb));
      } else {
        setKBs([...current, kb]);
      }
    },
    [state.knowledgeBases, setKBs],
  );
  const handleSelectNotebookPicker = useCallback(() => {
    setShowNotebookPicker(true);
  }, []);
  const handleSelectBookPicker = useCallback(() => {
    setShowBookPicker(true);
  }, []);
  const handleSelectHistoryPicker = useCallback(() => {
    setShowHistoryPicker(true);
  }, []);
  const handleSelectQuestionBankPicker = useCallback(() => {
    setShowQuestionBankPicker(true);
  }, []);
  const handleSelectSkillsPicker = useCallback(() => {
    setShowSkillsPicker(true);
  }, []);
  const handleSelectMemoryPicker = useCallback(() => {
    setShowMemoryPicker(true);
  }, []);
  const handleRemoveHistory = useCallback((sessionId: string) => {
    setSelectedHistorySessions((prev) =>
      prev.filter((item) => item.sessionId !== sessionId),
    );
  }, []);
  const handleRemoveNotebook = useCallback((notebookId: string) => {
    setSelectedNotebookRecords((prev) =>
      prev.filter((record) => record.notebookId !== notebookId),
    );
  }, []);
  const handleRemoveBookReference = useCallback((bookId: string) => {
    setSelectedBookReferences((prev) =>
      prev.filter((record) => record.bookId !== bookId),
    );
  }, []);
  const handleRemoveQuestion = useCallback((entryId: number) => {
    setSelectedQuestionEntries((prev) =>
      prev.filter((entry) => entry.id !== entryId),
    );
  }, []);
  const handleToggleSkill = useCallback((name: string) => {
    setSkillsAutoMode(false);
    setSelectedSkills((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }, []);

  const handleSetSkillsAuto = useCallback((auto: boolean) => {
    setSkillsAutoMode(auto);
    if (auto) setSelectedSkills([]);
  }, []);

  const handleToggleMemoryFile = useCallback((file: SpaceMemoryFile) => {
    setSelectedMemoryFiles((prev) =>
      prev.includes(file)
        ? prev.filter((item) => item !== file)
        : [...prev, file],
    );
  }, []);

  const handleTogglePanelCollapsed = useCallback(() => {
    setPanelCollapsed((prev) => !prev);
  }, []);
  const handleCloseNotebookPicker = useCallback(() => {
    setShowNotebookPicker(false);
  }, []);
  const handleCloseBookPicker = useCallback(() => {
    setShowBookPicker(false);
  }, []);
  const handleApplyBookReferences = useCallback(
    (references: SelectedBookReference[]) => {
      setSelectedBookReferences(references);
    },
    [],
  );
  const handleApplyNotebookRecords = useCallback(
    (records: SelectedRecord[]) => {
      setSelectedNotebookRecords(records);
    },
    [],
  );
  const handleCloseHistoryPicker = useCallback(() => {
    setShowHistoryPicker(false);
  }, []);
  const handleApplyHistorySessions = useCallback(
    (sessions: SelectedHistorySession[]) => {
      setSelectedHistorySessions(sessions);
    },
    [],
  );
  const handleCloseQuestionBankPicker = useCallback(() => {
    setShowQuestionBankPicker(false);
  }, []);
  const handleApplyQuestionEntries = useCallback(
    (entries: SelectedQuestionEntry[]) => {
      setSelectedQuestionEntries(entries);
    },
    [],
  );
  const handleCloseSkillsPicker = useCallback(() => {
    setShowSkillsPicker(false);
  }, []);
  const handleApplySkillsSelection = useCallback(
    (selection: { auto: boolean; skills: string[] }) => {
      setSkillsAutoMode(selection.auto);
      setSelectedSkills(selection.auto ? [] : selection.skills);
    },
    [],
  );
  const handleCloseMemoryPicker = useCallback(() => {
    setShowMemoryPicker(false);
  }, []);
  const handleApplyMemoryFiles = useCallback((files: SpaceMemoryFile[]) => {
    setSelectedMemoryFiles(files);
  }, []);
  const handleCloseSaveModal = useCallback(() => {
    setShowSaveModal(false);
  }, []);

  const handleNewChat = useCallback(() => {
    router.push("/chat");
  }, [router]);

  const handleDownloadMarkdown = useCallback(() => {
    if (!state.messages.length) return;
    const title =
      state.messages
        .find((msg) => msg.role === "user")
        ?.content.trim()
        .slice(0, 80) || "Chat Session";
    downloadChatMarkdown(state.messages, { title });
  }, [state.messages]);

  /* 表情球：进门先「欢迎」3s（组件挂载即触发，进聊天页就算进门），
   * 之后交给状态映射；一轮回答跑完直接给「完成」（20，彩带），
   * 2.4s 后整体回落待机。（感叹过门 23 已退役，不再单独闪一下"!"） */
  const [ballWelcoming, setBallWelcoming] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setBallWelcoming(false), 3000);
    return () => clearTimeout(timer);
  }, []);
  const [ballDoneAt, setBallDoneAt] = useState(0);
  const prevStreamingRef = useRef(state.isStreaming);
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = state.isStreaming;
    if (wasStreaming && !state.isStreaming) setBallDoneAt(Date.now());
  }, [state.isStreaming]);
  useEffect(() => {
    if (!ballDoneAt) return;
    const timer = setTimeout(() => setBallDoneAt(0), 2400);
    return () => clearTimeout(timer);
  }, [ballDoneAt]);
  /* 用户在输入框里打字（有内容，不是聚焦）——球切成「倾听」。 */
  const [userTyping, setUserTyping] = useState(false);
  /* 模型是否**已经开始吐字**：本轮最后一条助手消息有内容就算。
   * 这比 stage 名可靠（各能力的阶段名不统一），而且一旦有内容，
   * 球就该从「思考/翻书」切到「回答中」——思考链（10 → 11）也就此中断。
   * 新一轮开始时 STREAM_START 会压入一条空的助手消息，answering 自然回到 false。 */
  const ballAnswering = useMemo(() => {
    if (!state.isStreaming) return false;
    for (let i = state.messages.length - 1; i >= 0; i -= 1) {
      const m = state.messages[i];
      if (m.role !== "assistant") continue;
      return (m.content || "").trim().length > 0;
    }
    return false;
  }, [state.isStreaming, state.messages]);
  const ballEmotion = ballWelcoming
    ? "02"
    : ballDoneAt
      ? "20"
      : resolveEmotion({
          isStreaming: state.isStreaming,
          stage: state.currentStage,
          typing: userTyping,
          answering: ballAnswering,
        });

  return (
    <div
      // When the preview drawer is open AND the viewport is wide enough,
      // push the chat content to the left by the drawer's width so the two
      // panels live side-by-side (matches Claude desktop). On smaller
      // screens the drawer overlays — squeezing a phone-width chat into
      // the remaining ~30 px would be useless. The actual padding +
      // transition lives in `chat-preview-shell` (globals.css) so we can
      // hand-tune it without fighting Tailwind's arbitrary-value parser.
      data-preview-open={previewSource ? "true" : "false"}
      className="chat-preview-shell relative flex h-full flex-col overflow-hidden bg-[var(--background)]"
    >
      <div className="campus-chat-toolbar flex w-full shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--border)]/60 px-5 py-4 sm:px-8">
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
          <SplitText text={t(activeCap.label)} delay={65}/>
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSaveModal(true)}
            disabled={!chatSavePayload}
            className="rounded-lg border border-[var(--border)]/50 px-3 py-1.5 text-[12px] font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--border)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[var(--border)]/50 disabled:hover:text-[var(--muted-foreground)]"
          >
            {t("Save to Notebook")}
          </button>
          <button
            onClick={handleDownloadMarkdown}
            disabled={!state.messages.length}
            title={t("Download chat history as Markdown")}
            className="rounded-lg border border-[var(--border)]/50 px-3 py-1.5 text-[12px] font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--border)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[var(--border)]/50 disabled:hover:text-[var(--muted-foreground)]"
          >
            {t("Download Markdown")}
          </button>
          <button
            onClick={handleNewChat}
            className="rounded-lg border border-[var(--border)]/50 px-3 py-1.5 text-[12px] font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--border)] hover:text-[var(--foreground)]"
          >
            {t("New chat")}
          </button>
        </div>
      </div>
      <div className="relative mx-auto flex w-full max-w-[900px] flex-1 min-h-0 flex-col overflow-hidden px-4 sm:px-8">
        {!hasMessages ? (
          <div className="flex flex-1 min-h-0 flex-col items-center justify-center animate-fade-in">
            <div className="flex w-full justify-center">
              <GlitchPromptTitle
                title={t("What would you like to ask?")}
                subtitle={t("Ask anything — I'm here to help you answer.")}
              />
            </div>
          </div>
        ) : (
          <div
            ref={messagesContainerRef}
            data-chat-scroll-root="true"
            onScroll={handleMessagesScroll}
            className={`mx-auto w-full flex-1 min-h-0 space-y-7 overflow-y-auto pr-4 [scrollbar-gutter:stable] ${hasMessages ? "pt-4" : "pt-2 pb-6"}`}
            style={
              hasMessages
                ? (() => {
                    const maskImage =
                      "linear-gradient(to bottom, transparent 0px, #000 14px, #000 calc(100% - 40px), transparent 100%)";
                    return {
                      paddingBottom: "4px",
                      WebkitMaskImage: maskImage,
                      maskImage,
                    };
                  })()
                : undefined
            }
          >
            <ChatMessageList
              messages={state.messages}
              isStreaming={state.isStreaming}
              sessionId={state.sessionId}
              language={state.language}
              onCopyAssistantMessage={copyAssistantMessage}
              onRegenerateMessage={handleRegenerateMessage}
              onConfirmOutline={handleConfirmOutline}
              onPreviewAttachment={handlePreviewMessageAttachment}
              onPreviewSource={handlePreviewKnowledgeSource}
            />
            <div ref={messagesEndRef} className="h-px w-full shrink-0" />
          </div>
        )}
      </div>
      {/* 表情球 + 输入框：窄屏（<1400）真并排——flex 行里球占固定宽、输入框 flex-1。
          不设 gap：球在宿主里自带 ~13px 内边留白（0.11×size），视觉间隙正好，
          再加 gap 就会像之前那样中间空一截。压缩需求 = 球缩小、输入框变短，天然成立。
          宽屏（≥1400）时球切 absolute 脱离文档流，贴窗格左边挨导航栏（wrapper 占满
          窗格宽，left-3 就是窗格坐标），size 收回 96；输入框不受影响，靠内层
          max-w-960 居中，和上方消息列对齐。球 svg pointer-events:none、
          只有球面（.cw-hit）能点。 */}
      <div className="relative mx-auto flex w-full max-w-[900px] shrink-0 items-end px-4 sm:px-8">
        <EmotionBall
          emotion={ballEmotion}
          size={120}
          className="cw-ball-host pointer-events-none absolute bottom-6 -left-24 z-30 hidden min-[1700px]:flex [&>div:first-child]:!w-20"
        />
        <div className="min-w-0 flex-1">
          {/* 窄屏下输入框不再伸到贴边：右缘收进来到 720px 封顶（左缘仍贴着球，
              ml-0 覆盖 mx-auto 的居中）。宽屏维持 820 居中与消息列对齐。
              预览抽屉打开时由 globals.css 的 .cw-composer-host 规则强制回到这套
              左对齐布局（内容区被右推 560px，居中会与 absolute 的球重叠）。 */}
          <div className="cw-composer-host mx-auto w-full">
        <ChatComposer
          composerRef={composerRef}
          capMenuRef={capMenuRef}
          capBtnRef={capBtnRef}
          toolMenuRef={toolMenuRef}
          toolBtnRef={toolBtnRef}
          spaceMenuRef={spaceMenuRef}
          spaceBtnRef={spaceBtnRef}
          dragCounter={dragCounter}
          dragging={dragging}
          capMenuOpen={capMenuOpen}
          toolMenuOpen={toolMenuOpen}
          spaceMenuOpen={spaceMenuOpen}
          hasMessages={hasMessages}
          attachments={attachments}
          attachmentError={attachmentError}
          activeCap={activeCap}
          visibleTools={visibleTools}
          selectedTools={selectedTools}
          ragActive={ragActive}
          knowledgeBases={knowledgeBases}
          llmOptions={llmOptions}
          activeLLMDefault={activeLLMDefault}
          llmSelection={state.llmSelection}
          llmOptionsLoading={llmOptionsLoading}
          llmOptionsError={llmOptionsError}
          selectedBookReferences={selectedBookReferences}
          selectedNotebookRecords={selectedNotebookRecords}
          selectedHistorySessions={selectedHistorySessions}
          selectedQuestionEntries={selectedQuestionEntries}
          notebookReferenceGroups={notebookReferenceGroups}
          selectedSkills={selectedSkills}
          skillsAutoMode={skillsAutoMode}
          selectedMemoryFiles={selectedMemoryFiles}
          stateKnowledgeBases={state.knowledgeBases}
          kbMenuOpen={kbMenuOpen}
          kbMenuRef={kbMenuRef}
          kbBtnRef={kbBtnRef}
          plusMenuOpen={plusMenuOpen}
          plusMenuRef={plusMenuRef}
          plusBtnRef={plusBtnRef}
          onSetPlusMenuOpen={setPlusMenuOpen}
          isStreaming={state.isStreaming}
          isResearchMode={isResearchMode}
          isQuizMode={isQuizMode}
          isMathAnimatorMode={isMathAnimatorMode}
          isVisualizeMode={isVisualizeMode}
          quizConfig={quizConfig}
          quizPdf={quizPdf}
          mathAnimatorConfig={mathAnimatorConfig}
          visualizeConfig={visualizeConfig}
          researchConfig={researchConfig}
          researchValidationErrors={researchValidation.errors}
          panelCollapsed={panelCollapsed}
          capabilities={visibleCapabilities}
          spaceKeys={visibleSpaceKeys}
          researchSources={RESEARCH_SOURCES}
          onSetCapMenuOpen={setCapMenuOpen}
          onSetToolMenuOpen={setToolMenuOpen}
          onSetSpaceMenuOpen={setSpaceMenuOpen}
          onToggleKB={handleToggleKB}
          onSetKbMenuOpen={setKbMenuOpen}
          onSelectLLM={setLLMSelection}
          onSelectNotebookPicker={handleSelectNotebookPicker}
          onSelectBookPicker={handleSelectBookPicker}
          onSelectHistoryPicker={handleSelectHistoryPicker}
          onSelectQuestionBankPicker={handleSelectQuestionBankPicker}
          onSelectSkillsPicker={handleSelectSkillsPicker}
          onSelectMemoryPicker={handleSelectMemoryPicker}
          onToggleTool={toggleTool}
          onToggleSkill={handleToggleSkill}
          onSetSkillsAuto={handleSetSkillsAuto}
          onToggleMemoryFile={handleToggleMemoryFile}
          onToggleResearchSource={toggleResearchSource}
          fastMode={fastMode}
          onToggleFastMode={toggleFastMode}
          onSend={handleSend}
          onRemoveAttachment={removeAttachment}
          onPreviewAttachment={handlePreviewPendingAttachment}
          onRemoveHistory={handleRemoveHistory}
          onRemoveBookReference={handleRemoveBookReference}
          onRemoveNotebook={handleRemoveNotebook}
          onRemoveQuestion={handleRemoveQuestion}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onPaste={handlePaste}
          onAddFiles={handleAddFiles}
          onSelectCapability={handleSelectCapability}
          onCancelStreaming={cancelStreamingTurn}
          onChangeQuizConfig={setQuizConfig}
          onUploadQuizPdf={setQuizPdf}
          onChangeMathAnimatorConfig={setMathAnimatorConfig}
          onChangeVisualizeConfig={setVisualizeConfig}
          onChangeResearchConfig={setResearchConfig}
          onTogglePanelCollapsed={handleTogglePanelCollapsed}
          onHasContentChange={setUserTyping}
        />
          </div>
        </div>
      </div>
      <NotebookRecordPicker
        open={showNotebookPicker}
        onClose={handleCloseNotebookPicker}
        onApply={handleApplyNotebookRecords}
      />
      <BookReferencePicker
        open={showBookPicker}
        initialReferences={selectedBookReferences}
        onClose={handleCloseBookPicker}
        onApply={handleApplyBookReferences}
      />
      <HistorySessionPicker
        open={showHistoryPicker}
        onClose={handleCloseHistoryPicker}
        onApply={handleApplyHistorySessions}
      />
      <QuestionBankPicker
        open={showQuestionBankPicker}
        onClose={handleCloseQuestionBankPicker}
        onApply={handleApplyQuestionEntries}
      />
      <SkillsPicker
        open={showSkillsPicker}
        initialAuto={skillsAutoMode}
        initialSkills={selectedSkills}
        onClose={handleCloseSkillsPicker}
        onApply={handleApplySkillsSelection}
      />
      <MemoryPicker
        open={showMemoryPicker}
        initialFiles={selectedMemoryFiles}
        onClose={handleCloseMemoryPicker}
        onApply={handleApplyMemoryFiles}
      />
      <SaveToNotebookModal
        open={showSaveModal}
        payload={chatSavePayload}
        messages={chatSaveMessages}
        onClose={handleCloseSaveModal}
      />
      <FilePreviewDrawer
        open={previewSource !== null}
        source={previewSource}
        onClose={handleClosePreview}
      />
    </div>
  );
}
