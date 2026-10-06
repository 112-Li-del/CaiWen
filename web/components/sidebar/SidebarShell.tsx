"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { useAppShell } from "@/context/AppShellContext";
import {
  BookOpen,
  Bot,
  Github,
  LayoutGrid,
  Library,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Plus,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { TutorBotRecent } from "@/components/sidebar/TutorBotRecent";
import { VersionBadge } from "@/components/sidebar/VersionBadge";
import type { SessionSummary } from "@/lib/session-api";
import { Tooltip } from "@/components/ui/Tooltip";
import StaggeredMenu, {
  type StaggeredMenuItem,
} from "@/components/ui/StaggeredMenu";
import BranchedMenu, {
  type BranchedMenuSection,
  type BranchedMenuItem,
} from "@/components/ui/BranchedMenu";

interface NavEntry {
  href: string;
  label: string;
  icon: LucideIcon;
  tooltipKey?: string;
}

const PRIMARY_NAV: NavEntry[] = [
  {
    href: "/chat",
    label: "Chat",
    icon: MessageSquare,
    tooltipKey: "Chat tooltip",
  },
  {
    href: "/agents",
    label: "TutorBot",
    icon: Bot,
    tooltipKey: "TutorBot tooltip",
  },
  {
    href: "/co-writer",
    label: "Co-Writer",
    icon: PenLine,
    tooltipKey: "Co-Writer tooltip",
  },
  { href: "/book", label: "Book", icon: Library, tooltipKey: "Book tooltip" },
  {
    href: "/knowledge",
    label: "Knowledge",
    icon: BookOpen,
    tooltipKey: "Knowledge tooltip",
  },
  {
    href: "/space",
    label: "Space",
    icon: LayoutGrid,
    tooltipKey: "Space tooltip",
  },
];

const SECONDARY_NAV: NavEntry[] = [
  { href: "/settings", label: "Settings", icon: Settings },
];
const DEFAULT_SESSION_VIEWPORT_CLASS_NAME = "max-h-[112px]";
const GITHUB_REPO_URL = "https://github.com/HKUDS/DeepTutor";

interface SidebarShellProps {
  sessions?: SessionSummary[];
  activeSessionId?: string | null;
  loadingSessions?: boolean;
  showSessions?: boolean;
  sessionViewportClassName?: string;
  onNewChat?: () => void;
  onSelectSession?: (sessionId: string) => void | Promise<void>;
  onRenameSession?: (sessionId: string, title: string) => void | Promise<void>;
  onDeleteSession?: (sessionId: string) => void | Promise<void>;
  footerSlot?: ReactNode;
  /** When false (default), admin-only nav items are hidden (see ADMIN_ONLY_HREFS). */
  isAdmin?: boolean;
}

/** Nav entries that are only visible to admin users.
 *  「收入口不删码」：辅导机器人/智能写作/书籍对普通用户隐藏（管理员演示用），
 *  路由级兜底见 middleware.ts 的 ADMIN_ROUTES。 */
const ADMIN_ONLY_HREFS = new Set([
  "/knowledge",
  "/space",
  "/agents",
  "/co-writer",
  "/book",
]);

/** 管理员侧收进「功能」全屏菜单的 nav 项（2026-10 与用户定）。
 *  知识库保留在侧边栏（财问核心，管理员需管理）；这四项管理员也不常
 *  用，统一收进 StaggeredMenu，点击后从右侧滑出。代码零删除，恢复
 *  只需把对应 href 从本 Set 移除并放回 visibleNav。 */
const FEATURE_MENU_HREFS = new Set([
  "/agents",
  "/co-writer",
  "/book",
  "/space",
]);

export function SidebarShell({
  sessions = [],
  activeSessionId = null,
  loadingSessions = false,
  showSessions = false,
  sessionViewportClassName = DEFAULT_SESSION_VIEWPORT_CLASS_NAME,
  onNewChat,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  footerSlot,
  isAdmin = false,
}: SidebarShellProps) {
  /* 管理员主 nav 只留聊天：知识库移到底部、四项功能收进「功能」菜单（也在底部）。
   * 普通用户：过滤 ADMIN_ONLY_HREFS，只剩聊天。 */
  const ADMIN_TOP_HIDDEN = new Set([
    "/knowledge",
    ...FEATURE_MENU_HREFS,
  ]);
  const visibleNav = isAdmin
    ? PRIMARY_NAV.filter((item) => !ADMIN_TOP_HIDDEN.has(item.href))
    : PRIMARY_NAV.filter((item) => !ADMIN_ONLY_HREFS.has(item.href));
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const { sidebarCollapsed: collapsed, setSidebarCollapsed: setCollapsed } =
    useAppShell();

  /* 「功能」全屏菜单（StaggeredMenu）受控状态，仅管理员使用 */
  const [featureMenuOpen, setFeatureMenuOpen] = useState(false);
  const featureMenuItems: StaggeredMenuItem[] = [
    {
      label: "辅导机器人",
      ariaLabel: "辅导机器人",
      onClick: () => {
        router.push("/agents");
        setFeatureMenuOpen(false);
      },
    },
    {
      label: "智能写作",
      ariaLabel: "智能写作",
      onClick: () => {
        router.push("/co-writer");
        setFeatureMenuOpen(false);
      },
    },
    {
      label: "书籍",
      ariaLabel: "书籍",
      onClick: () => {
        router.push("/book");
        setFeatureMenuOpen(false);
      },
    },
    {
      label: "空间",
      ariaLabel: "空间",
      onClick: () => {
        router.push("/space");
        setFeatureMenuOpen(false);
      },
    },
  ];

  const handleNewChat = () => {
    if (onNewChat) {
      onNewChat();
      return;
    }
    router.push("/chat");
  };

  /* 「功能」全屏菜单元素：仅管理员渲染，从右侧滑出，南财红 + 深蓝配色 */
  const featureMenuEl = isAdmin ? (
    <StaggeredMenu
      isFixed
      hideHeader
      position="right"
      open={featureMenuOpen}
      onOpenChange={setFeatureMenuOpen}
      items={featureMenuItems}
      displaySocials={false}
      displayItemNumbering={true}
      colors={["#1e3a5f", "#EF4444"]}
      accentColor="#EF4444"
    />
  ) : null;

  /* 会话重命名编辑态（BranchedMenu 子项 input） */
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(
    null,
  );

  /* 会话按时间分组（今天 / 昨天 / 更早），转成 BranchedMenu items */
  const sessionMenuItems = useMemo<BranchedMenuSection[]>(() => {
    if (!sessions.length) return [];
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    const yesterdayStart = todayStart - 86400000;
    const groups: { label: string; items: SessionSummary[] }[] = [
      { label: "今天", items: [] },
      { label: "昨天", items: [] },
      { label: "更早", items: [] },
    ];
    for (const s of sessions) {
      /* 后端 time.time() 返回秒级时间戳，前端比较前 ×1000 转毫秒 */
      const ts = (s.updated_at || s.created_at) * 1000;
      if (ts >= todayStart) groups[0].items.push(s);
      else if (ts >= yesterdayStart) groups[1].items.push(s);
      else groups[2].items.push(s);
    }
    return groups
      .filter((g) => g.items.length > 0)
      .map((g) => ({
        label: g.label,
        children: g.items.map(
          (s): BranchedMenuItem => ({
            value: s.session_id,
            label: s.title || "新对话",
            actions: [
              {
                label: "重命名",
                onClick: () => setRenamingSessionId(s.session_id),
              },
              {
                label: "删除",
                danger: true,
                onClick: () => onDeleteSession?.(s.session_id),
              },
            ],
          }),
        ),
      }));
  }, [sessions, onDeleteSession]);

  /* 是否渲染会话树（BranchedMenu）：有会话 + 三个回调齐全 */
  const showSessionTree =
    showSessions &&
    !!onSelectSession &&
    !!onRenameSession &&
    !!onDeleteSession &&
    sessionMenuItems.length > 0;

  /* ---- Collapsed state ---- */
  if (collapsed) {
    return (
      <>
        <aside className="group/sb relative flex h-screen w-[60px] shrink-0 flex-col items-center bg-[var(--secondary)] py-3 transition-all duration-200">
        {/* Header: logo + collapse toggle (toggle replaces logo on hover) */}
        <div className="relative mb-2 flex h-9 w-9 items-center justify-center">
          <Link
            href="/"
            aria-label="DeepTutor"
            className="flex items-center justify-center transition-opacity duration-150 group-hover/sb:opacity-0"
          >
            <Image
              src="/god.png"
              alt="DeepTutor"
              width={22}
              height={22}
              className="h-[22px] w-[22px] rounded-md"
            />
          </Link>
          <button
            onClick={() => setCollapsed(false)}
            className="absolute inset-0 flex items-center justify-center rounded-lg text-[var(--muted-foreground)] opacity-0 transition-all duration-150 hover:bg-[var(--background)]/60 hover:text-[var(--foreground)] group-hover/sb:opacity-100"
            aria-label={t("Expand sidebar")}
          >
            <PanelLeftOpen size={16} />
          </button>
        </div>

        {/* New chat — visually distinct circular button */}
        <button
          onClick={handleNewChat}
          title={t("New Chat") as string}
          className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)]/50 bg-[var(--background)]/40 text-white shadow-sm transition-all duration-150 hover:border-[var(--border)] hover:bg-[var(--background)]/80 hover:text-white"
          aria-label={t("New Chat")}
        >
          <Plus size={16} strokeWidth={2.2} />
        </button>

        {/* Subtle divider */}
        <div className="my-1.5 h-px w-7 bg-[var(--border)]/40" />

        {/* Primary nav */}
        <nav className="flex w-full flex-col items-center gap-1 px-1.5">
          {visibleNav.map((item) => {
            const active = pathname.startsWith(item.href);
            const description = item.tooltipKey
              ? t(item.tooltipKey)
              : undefined;
            return (
              <Tooltip
                key={item.href}
                label={t(item.label)}
                description={description}
                side="right"
              >
                <Link
                  href={item.href}
                  aria-label={t(item.label)}
                  className={`relative flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-150 ${
                    active
                      ? "bg-[var(--background)]/80 text-[var(--foreground)] shadow-sm"
                      : "text-white hover:bg-[var(--background)]/50 hover:text-white"
                  }`}
                >
                  {active && (
                    <span className="absolute -left-1.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[var(--foreground)]/80" />
                  )}
                  <item.icon size={18} strokeWidth={active ? 2 : 1.6} />
                </Link>
              </Tooltip>
            );
          })}
        </nav>

        <div className="flex-1" />

        {/* 管理员：知识库 + 功能图标（紧贴分隔线上方；分隔线本身不动） */}
        {isAdmin && (
          <div className="flex w-full flex-col items-center gap-1 px-1.5 pb-1">
            <Tooltip label="知识库" side="right">
              <Link
                href="/knowledge"
                aria-label="知识库"
                className={`relative flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-150 ${
                  pathname.startsWith("/knowledge")
                    ? "bg-[var(--background)]/80 text-[var(--foreground)] shadow-sm"
                    : "text-white hover:bg-[var(--background)]/50 hover:text-white"
                }`}
              >
                {pathname.startsWith("/knowledge") && (
                  <span className="absolute -left-1.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[var(--foreground)]/80" />
                )}
                <BookOpen
                  size={18}
                  strokeWidth={
                    pathname.startsWith("/knowledge") ? 2 : 1.6
                  }
                />
              </Link>
            </Tooltip>
            <Tooltip label="功能" side="right">
              <button
                type="button"
                onClick={() => setFeatureMenuOpen(true)}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label="功能"
                className={`relative flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-150 ${
                  featureMenuOpen
                    ? "bg-[var(--background)]/80 text-[var(--foreground)] shadow-sm"
                    : "text-white hover:bg-[var(--background)]/50 hover:text-white"
                }`}
              >
                {featureMenuOpen && (
                  <span className="absolute -left-1.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[var(--foreground)]/80" />
                )}
                <LayoutGrid
                  size={18}
                  strokeWidth={featureMenuOpen ? 2 : 1.6}
                />
              </button>
            </Tooltip>
          </div>
        )}

        {/* Secondary nav + footer */}
        <div className="flex w-full flex-col items-center gap-1 px-1.5">
          <div className="my-1 h-px w-7 bg-[var(--border)]/40" />
          {SECONDARY_NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={t(item.label) as string}
                className={`relative flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-150 ${
                  active
                    ? "bg-[var(--background)]/80 text-[var(--foreground)] shadow-sm"
                    : "text-white hover:bg-[var(--background)]/50 hover:text-white"
                }`}
              >
                {active && (
                  <span className="absolute -left-1.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[var(--foreground)]/80" />
                )}
                <item.icon size={18} strokeWidth={active ? 2 : 1.6} />
              </Link>
            );
          })}
          {footerSlot}
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            title="GitHub"
            aria-label="GitHub"
            className="mt-1 flex h-9 w-9 items-center justify-center rounded-xl text-white/70 transition-colors hover:bg-[var(--background)]/50 hover:text-white"
          >
            <Github size={15} strokeWidth={1.6} />
          </a>
          <VersionBadge collapsed />
        </div>
      </aside>
      {featureMenuEl}
      </>
    );
  }

  /* ---- Expanded state ---- */
  return (
    <>
      <aside className="flex w-[220px] h-screen shrink-0 flex-col bg-[var(--secondary)] transition-all duration-200">
      {/* Header: logo + collapse toggle */}
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/" className="group flex items-center gap-2">
          <Image
            src="/god.png"
            alt="DeepTutor"
            width={22}
            height={22}
            suppressHydrationWarning={true}
            className="h-[22px] w-[22px] transition-transform duration-200 group-hover:scale-105"
          />
          <span className="text-[16px] font-semibold leading-none tracking-[-0.02em] text-white">
            财问
          </span>
        </Link>
        <button
          onClick={() => setCollapsed(true)}
          className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          aria-label={t("Collapse sidebar")}
        >
          <PanelLeftClose size={15} />
        </button>
      </div>

      {/* Primary nav */}
      <nav className="px-2 pt-1">
        <div className="space-y-px">
          {/* New chat */}
          <button
            onClick={handleNewChat}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] text-white transition-colors hover:bg-[var(--background)]/60 hover:text-white"
          >
            <Plus size={16} strokeWidth={2} />
            <span>{t("New Chat")}</span>
          </button>

          {visibleNav.map((item) => {
            const active = pathname.startsWith(item.href);
            const hasBots = item.href === "/agents";
            return (
              <div key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                    active
                      ? "bg-[var(--background)]/70 font-semibold text-white"
                      : "text-white hover:bg-[var(--background)]/50 hover:text-white"
                  }`}
                >
                  <item.icon size={16} strokeWidth={active ? 1.9 : 1.5} />
                  <span>{t(item.label)}</span>
                </Link>
                {hasBots && <TutorBotRecent />}
              </div>
            );
          })}
        </div>
      </nav>

      {/* 会话树：占满 nav 与知识库之间的剩余空间，只与知识库留一点间距 */}
      {showSessionTree ? (
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2">
          <BranchedMenu
            items={sessionMenuItems}
            active={activeSessionId ?? undefined}
            defaultOpen={[0]}
            onSelect={(value) => onSelectSession?.(value)}
            editingValue={renamingSessionId}
            onRenameSubmit={(value, title) => {
              onRenameSession?.(value, title);
              setRenamingSessionId(null);
            }}
            onRenameCancel={() => setRenamingSessionId(null)}
            color="rgba(255,255,255,0.85)"
            accentColor="#fff"
            lineColor="rgba(255,255,255,0.2)"
            width={200}
            rowHeight={34}
            indent={36}
            fontSize={13.5}
          />
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* 管理员：知识库 + 功能（紧贴分隔线上方；分隔线本身不动，仍隔开设置） */}
      {isAdmin && (
        <div className="px-2 pb-1">
          <Link
            href="/knowledge"
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
              pathname.startsWith("/knowledge")
                ? "bg-[var(--background)]/70 font-semibold text-white"
                : "text-white hover:bg-[var(--background)]/50 hover:text-white"
            }`}
          >
            <BookOpen
              size={16}
              strokeWidth={
                pathname.startsWith("/knowledge") ? 1.9 : 1.5
              }
            />
            <span>知识库</span>
          </Link>
          <button
            type="button"
            onClick={() => setFeatureMenuOpen(true)}
            onMouseDown={(e) => e.stopPropagation()}
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
              featureMenuOpen
                ? "bg-[var(--background)]/70 font-semibold text-white"
                : "text-white hover:bg-[var(--background)]/50 hover:text-white"
            }`}
          >
            <LayoutGrid
              size={16}
              strokeWidth={featureMenuOpen ? 1.9 : 1.5}
            />
            <span>功能</span>
          </button>
        </div>
      )}

      {/* Secondary nav + footer */}
      <div className="border-t border-[var(--border)]/40 px-2 py-2">
        {SECONDARY_NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                active
                  ? "bg-[var(--background)]/70 font-semibold text-white"
                  : "text-white hover:bg-[var(--background)]/50 hover:text-white"
              }`}
            >
              <item.icon size={16} strokeWidth={active ? 1.9 : 1.5} />
              <span>{t(item.label)}</span>
            </Link>
          );
        })}
        {footerSlot}
        <div className="mt-0.5 flex items-center gap-0.5">
          <VersionBadge />
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            title="GitHub"
            aria-label="GitHub"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-[var(--background)]/50 hover:text-white"
          >
            <Github size={13} strokeWidth={1.7} />
          </a>
        </div>
      </div>
    </aside>
    {featureMenuEl}
    </>
  );
}
