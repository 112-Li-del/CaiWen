"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { login, fetchAuthStatus, checkIsFirstUser } from "@/lib/auth";
import AuthGridBackground from "@/components/auth/AuthGridBackground";
import StarBorder from "@/components/ui/StarBorder";
import StrokeText from "@/components/ui/StrokeText";
import ShinyText from "@/components/ui/ShinyText";

/** 南财红 — 南京财经大学标准色 */
const NUFE_RED = "#8B1A2B";
/** 牌匾深红 */
const PLAQUE_RED = "#4D0D10";
/** 暖米色底 */
const WARM_CREAM = "#F5F0E8";
/** 「财问」标题的 SVG 字号：StrokeText 的视觉高度 ≈ fontSize × 1.3 */
const TITLE_SIZE = 56;

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
        style={{ backgroundColor: "rgba(139,26,43,0.80)" }}
      >
        {/* suppressHydrationWarning：浏览器扩展会在 hydration 前给 <img> 注入 data-* 属性，
            导致误报 mismatch。原因与注意事项见 components/auth/AuthGridBackground.tsx */}
        <img
          src="/nufe_logo.png"
          alt="南京财经大学"
          className="h-12 w-auto mx-auto mb-3 drop-shadow-sm"
          suppressHydrationWarning
        />
        <h2 className="text-white text-lg font-bold tracking-[0.3em]">
          {/* 白字 + 南财红扫光：高光取自学校标准色 */}
          <ShinyText
            text="南京财经大学"
            color="#ffffff"
            shineColor={NUFE_RED}
            speed={2}
          />
        </h2>
        <div className="flex items-center justify-center gap-2 mt-2">
          <span className="w-6 h-px bg-white/40" />
          <p className="text-white/80 text-xs tracking-[0.3em]">
            {/* 校训跟大字同色系扫光，但放慢节奏，避免两行同步闪显得躁 */}
            <ShinyText
              text="自谦 · 自信 · 务实 · 超越"
              color="rgba(255,255,255,0.8)"
              shineColor={NUFE_RED}
              speed={3}
            />
          </p>
          <span className="w-6 h-px bg-white/40" />
        </div>
      </div>

      {/* ======== 登录卡片主体 ======== */}
      <div
        className="rounded-b-2xl shadow-md px-8 pt-6 pb-8 "
        style={{
          backgroundColor: `${WARM_CREAM}88`,
          //borderColor: PLAQUE_RED,
          boxShadow: "0 4px 24px rgba(77,13,16,0.10)",
        }}
      >
        {/* 内框 */}
        <div
          className="rounded-xl border px-7 py-6"
          style={{ borderColor: `${NUFE_RED}30` ,
          backgroundColor: "rgba(255,255,255,0.01)"
        }}

         

        >

          {/* App 名称 */}
          <div className="text-center mb-6">
            <StrokeText
              as="h1"
              text="财问"
              style={{ fontFamily: "var(--font-calligraphy)" }}
              fontSize={TITLE_SIZE}
              fontWeight={400}
              letterSpacing={2}
              strokeWidth={1.5}
              // 全红：描边与填充同色，动画结束后两者融为一体
              strokeColor={NUFE_RED}
              fillColor={NUFE_RED}
              // 汉字笔画远多于拉丁字母，dash 必须给足（见组件头注释第 4 条）
              dashLength={TITLE_SIZE * 14}
              drawDuration={1.1}
              fillDelay={0.15}
              stagger={0.15}
            />
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
                用户名
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
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
                placeholder="请输入学号/工号"
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium mb-1.5"
                style={{ color: "#5C4033" }}
              >
                密码
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
                placeholder="请输入密码"
              />
            </div>

            {/* Error */}
            {error && (
              <p className="text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            {/* Submit */}
            <StarBorder
              as="button"
              type="submit"
              disabled={loading}
              className="w-full transition-opacity duration-200 hover:opacity-90 active:opacity-80"
              radius="rounded-lg"
              contentClassName="py-1 px-4 text-base tracking-wider shadow-sm"
              contentStyle={{ fontFamily: "var(--font-calligraphy)" }}
              color="#FFC94A"
              speed="3s"
              thickness={4}
              backgroundColor={NUFE_RED}
              textColor="#ffffff"
              borderColor="transparent"
              trackColor={NUFE_RED}
            >
              {loading ? t("Signing in…") : t("Sign in")}
            </StarBorder>
          </form>
        </div>
      </div>

      {/* 注册入口 — 整行改用书法字体，与「财问」标题统一 */}
      <p
        className="mt-5 text-center text-base"
        style={{
          color: "rgba(255,255,255,0.85)",
          fontFamily: "var(--font-calligraphy)",
        }}
      >
        {t("Don't have an account?")}{" "}
        <Link
          href="/register"
          className="inline-block px-3 py-1 rounded-md hover:opacity-85 transition-opacity"
          style={{
            color: NUFE_RED,
            backgroundColor: "#fff",
          }}
        >
          {t("Create one")}
        </Link>
      </p>

      {/* 底部 */}
      <p
        className="mt-5 text-center text-sm font-semibold tracking-wider"
        style={{ color: "rgba(255,255,255,0.75)" }}
      >
        南京财经大学 · 财问智能问答平台
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
      {/* 全屏背景：桌面端为可交互 GridDistortion，其他环境自动回退静态图 */}
      <div className="relative h-screen w-full overflow-hidden bg-[#201415]">
        <AuthGridBackground />
        <div className="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto p-4">
          <LoginPageContent />
        </div>
      </div>
    </Suspense>
  );
}