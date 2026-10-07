"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { LogOut, Settings, ShieldCheck } from "lucide-react";
import { AUTH_ENABLED, fetchAuthStatus, logout } from "@/lib/auth";

/**
 * 侧栏底部的用户区（2026-10 与用户定，对标 WorkBuddy）：
 * 头像 + 用户名，点开弹出大卡片（顶部大头像 + 用户名 + 菜单），
 * 弹出动效参考 ReactBits Prompt Bar 的 spring 挤压过冲。
 * 头像暂无上传功能，统一用 public/avatar-default.jpg；
 * 用户名来自 GET /api/v1/auth/status（AUTH_ENABLED=false 时显示「本地用户」）。
 */
interface UserMenuProps {
  collapsed?: boolean;
  /** 是否管理员（决定弹出菜单里有没有「管理」） */
  isAdmin?: boolean;
}

/**
 * 头像用 div + CSS 背景图渲染，而不是 <img>：
 * 本机装的 OCR 类浏览器扩展会在 React 水合前给 <img> 注入
 * data-extentions-extra-ocr-id 属性，导致 hydration mismatch。
 * 背景图没有 img 元素，扩展无从注入，报错随之消失。
 */
const AVATAR_URL = "/avatar-default.jpg";

function Avatar({
  size,
  label,
  ring = "",
}: {
  size: number;
  label: string;
  ring?: string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`shrink-0 rounded-full ${ring}`}
      style={{
        width: size,
        height: size,
        backgroundImage: `url("${AVATAR_URL}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    />
  );
}

/* 弹出卡片动效：参考 ReactBits Prompt Bar 的 spring 手感
   （快速起弹 + 轻微过冲，transform-origin 在触发点一角） */
const popVariants = {
  initial: { opacity: 0, scale: 0.88, y: 12 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.94, y: 8 },
};

const popTransition = {
  type: "spring" as const,
  stiffness: 480,
  damping: 28,
  mass: 0.9,
};

export function UserMenu({ collapsed = false, isAdmin = false }: UserMenuProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState<string>("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (AUTH_ENABLED) {
      fetchAuthStatus().then((status) => {
        setUsername(status?.username ?? "");
      });
    } else {
      setUsername("local");
    }
  }, []);

  /* 点击外部 / Esc 关闭 */
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /* 路由变化时收起 */
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  async function handleLogout() {
    setOpen(false);
    await logout();
    router.replace("/login");
  }

  const displayName = username || (AUTH_ENABLED ? "…" : t("Local User"));

  const itemClass = (active: boolean) =>
    `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] transition-colors ${
      active
        ? "bg-white/12 font-semibold text-white"
        : "text-white/85 hover:bg-white/10 hover:text-white"
    }`;

  const menuItems = (
    <>
      <Link
        href="/settings"
        className={itemClass(pathname.startsWith("/settings"))}
        onClick={() => setOpen(false)}
      >
        <Settings size={17} strokeWidth={1.7} />
        <span>{t("Settings")}</span>
      </Link>
      {AUTH_ENABLED && isAdmin && (
        <Link
          href="/admin/users"
          className={itemClass(pathname.startsWith("/admin"))}
          onClick={() => setOpen(false)}
        >
          <ShieldCheck size={17} strokeWidth={1.7} />
          <span>{t("Admin")}</span>
        </Link>
      )}
      {AUTH_ENABLED && (
        <>
          <div className="my-1.5 h-px bg-white/10" />
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] text-white/85 transition-colors hover:bg-white/10 hover:text-red-400"
          >
            <LogOut size={17} strokeWidth={1.7} />
            <span>{t("Sign out")}</span>
          </button>
        </>
      )}
    </>
  );

  /* 弹出卡片：WorkBuddy 式大卡片，顶部大头像 + 用户名 */
  const card = (style: React.CSSProperties) => (
    <motion.div
      variants={popVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={popTransition}
      style={style}
      className="absolute z-50 w-[248px] rounded-2xl border border-[var(--border)]/40 bg-[var(--background)] p-2 shadow-2xl shadow-black/30"
    >
      {/* 头部：大头像 + 用户名 */}
      <div className="flex items-center gap-3 px-2 pb-3 pt-2">
        <Avatar size={44} label={displayName} ring="ring-1 ring-white/25" />
        <div className="min-w-0">
          <div className="truncate text-[14.5px] font-semibold text-white">
            {displayName}
          </div>
        </div>
      </div>
      <div className="mb-1.5 h-px bg-white/10" />
      {menuItems}
    </motion.div>
  );

  /* ---- 折叠态：只显示头像，卡片弹出在右侧 ---- */
  if (collapsed) {
    return (
      <div ref={rootRef} className="relative flex justify-center">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={displayName}
          title={displayName}
          className={`mt-1 flex h-10 w-10 items-center justify-center rounded-full transition-all duration-150 ${
            open
              ? "ring-2 ring-white/60"
              : "ring-1 ring-white/20 hover:ring-white/50"
          }`}
        >
          <Avatar size={32} label={displayName} />
        </button>
        <AnimatePresence>
          {open &&
            card({
              bottom: 0,
              left: "100%",
              marginLeft: 10,
              transformOrigin: "bottom left",
            })}
        </AnimatePresence>
      </div>
    );
  }

  /* ---- 展开态：头像 + 用户名一行，卡片弹出在上方 ---- */
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 transition-colors ${
          open ? "bg-white/10" : "hover:bg-white/10"
        }`}
      >
        <Avatar
          size={32}
          label={displayName}
          ring={`transition-all ${
            open ? "ring-2 ring-white/60" : "ring-1 ring-white/20"
          }`}
        />
        <span className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-white/90">
          {displayName}
        </span>
      </button>
      <AnimatePresence>
        {open &&
          card({
            bottom: "100%",
            left: 0,
            marginBottom: 10,
            transformOrigin: "bottom left",
          })}
      </AnimatePresence>
    </div>
  );
}
