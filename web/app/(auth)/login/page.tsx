"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { login, fetchAuthStatus, checkIsFirstUser } from "@/lib/auth";

/** 南财红 — 南京财经大学标准色 */
const NUFE_RED = "#8B1A2B";
/** 牌匾深红 */
const PLAQUE_RED = "#4D0D10";
/** 暖米色底 */
const WARM_CREAM = "#F5F0E8";

function LoginPageContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";

  const registered = searchParams.get("registered") === "1";
  const pending = searchParams.get("pending") === "1";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchAuthStatus().then((status) => {
      if (status?.authenticated) {
        router.replace(next);
        return;
      }
      checkIsFirstUser().then((first) => {
        if (first) router.replace("/register");
      });
    });
  }, [router, next]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await login(username, password);

    if (result.ok) {
      router.replace(next);
    } else {
      setError(result.error ?? t("Login failed"));
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md">
      {/* ======== 南财红顶栏横幅 ======== */}
      <div
        className="rounded-t-2xl px-6 py-5 text-center"
        style={{ backgroundColor: NUFE_RED }}
      >
        <img
          src="/nufe_logo.png"
          alt="南京财经大学"
          className="h-12 w-auto mx-auto mb-3 drop-shadow-sm"
          suppressHydrationWarning
        />
        <h2 className="text-white text-lg font-bold tracking-[0.3em]">
          南京财经大学
        </h2>
        <div className="flex items-center justify-center gap-2 mt-2">
          <span className="w-6 h-px bg-white/40" />
          <p className="text-white/80 text-xs tracking-[0.3em]">
            自谦 · 自信 · 务实 · 超越
          </p>
          <span className="w-6 h-px bg-white/40" />
        </div>
      </div>

      {/* ======== 登录卡片主体 ======== */}
      <div
        className="rounded-b-2xl shadow-md px-8 pt-6 pb-8 border-l-2 border-r-2 border-b-2"
        style={{
          backgroundColor: WARM_CREAM,
          borderColor: PLAQUE_RED,
          boxShadow: "0 4px 24px rgba(77,13,16,0.10)",
        }}
      >
        {/* 内框 */}
        <div
          className="rounded-xl border px-7 py-6"
          style={{ borderColor: `${NUFE_RED}30` }}
        >
          {/* App 名称 */}
          <div className="text-center mb-6">
            <h1
              className="text-3xl tracking-wide"
              style={{
                color: NUFE_RED,
                fontFamily: "var(--font-calligraphy)",
              }}
            >
              财问
            </h1>
            <p className="mt-1 text-sm" style={{ color: "#8B7355" }}>
              {t("Sign in to your account")}
            </p>
          </div>

          {/* Registered / Pending notices */}
          {registered && (
            <div className="mb-4 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm text-green-600">
              {t("Account created! Sign in to continue.")}
            </div>
          )}
          {pending && (
            <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-600">
              {t(
                "Your account has been created and is pending admin approval. You will be able to log in once approved.",
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium mb-1.5"
                style={{ color: "#5C4033" }}
              >
                {t("Email")}
              </label>
              <input
                id="username"
                type="email"
                autoComplete="email"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg border
                           bg-white text-[var(--foreground)]
                           placeholder:text-gray-400
                           focus:outline-none focus:ring-2 focus:border-transparent
                           transition-shadow text-sm"
                style={{
                  borderColor: `${NUFE_RED}30`,
                  "--tw-ring-color": NUFE_RED,
                } as React.CSSProperties}
                placeholder="you@example.com"
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium mb-1.5"
                style={{ color: "#5C4033" }}
              >
                {t("Password")}
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg border
                           bg-white text-[var(--foreground)]
                           placeholder:text-gray-400
                           focus:outline-none focus:ring-2 focus:border-transparent
                           transition-shadow text-sm"
                style={{
                  borderColor: `${NUFE_RED}30`,
                  "--tw-ring-color": NUFE_RED,
                } as React.CSSProperties}
                placeholder="••••••••"
              />
            </div>

            {/* Error */}
            {error && (
              <p className="text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg font-medium text-sm text-white
                         hover:opacity-90 active:opacity-80
                         disabled:opacity-50 disabled:cursor-not-allowed
                         transition-all duration-200 shadow-sm tracking-wider"
              style={{ backgroundColor: NUFE_RED }}
            >
              {loading ? t("Signing in…") : t("Sign in")}
            </button>
          </form>
        </div>
      </div>

      {/* 注册入口 */}
      <p className="mt-5 text-center text-sm" style={{ color: "#8B7355" }}>
        {t("Don't have an account?")}{" "}
        <Link
          href="/register"
          className="hover:underline font-medium"
          style={{ color: NUFE_RED }}
        >
          {t("Create one")}
        </Link>
      </p>

      {/* 底部 */}
      <p
        className="mt-5 text-center text-xs tracking-wider"
        style={{ color: "#B8A89A" }}
      >
        南京财经大学 · CaiWen AI 学习平台
      </p>
    </div>
  );
}

export default function LoginPage() {
  const { t } = useTranslation();
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-sm text-center text-sm text-[var(--muted-foreground)]">
          {t("Loading sign in…")}
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
