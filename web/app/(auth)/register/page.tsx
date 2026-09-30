"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { register, checkIsFirstUser, fetchAuthStatus } from "@/lib/auth";
import AuthGridBackground from "@/components/auth/AuthGridBackground";
import StarBorder from "@/components/ui/StarBorder";
import ShinyText from "@/components/ui/ShinyText";

/** 南财红 */
const NUFE_RED = "#8B1A2B";
/** 牌匾深红 */
const PLAQUE_RED = "#4D0D10";
/** 暖米色底 */
const WARM_CREAM = "#F5F0E8";

export default function RegisterPage() {
  const { t } = useTranslation();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isFirst, setIsFirst] = useState(false);
  const [checkingFirst, setCheckingFirst] = useState(true);

  useEffect(() => {
    fetchAuthStatus().then((status) => {
      if (status?.authenticated) router.replace("/");
    });
    checkIsFirstUser().then((first) => {
      setIsFirst(first);
      setCheckingFirst(false);
    });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError(t("Passwords do not match"));
      return;
    }

    setLoading(true);
    const result = await register(username, password);

    if (result.ok) {
      if (result.status === "pending") {
        router.replace("/login?pending=1");
      } else {
        router.replace("/login?registered=1");
      }
    } else {
      setError(result.error ?? t("Registration failed"));
      setLoading(false);
    }
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#201415]">
      <AuthGridBackground />
      <div className="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto p-4">
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
          {/* 白字 + 南财红扫光：高光取自学校标准色（与登录页一致） */}
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

      {/* ======== 注册卡片主体 ======== */}
      <div
        className="rounded-b-2xl shadow-md px-8 pt-6 pb-8 "
        style={{
          backgroundColor:`${WARM_CREAM}88`,
          //borderColor: PLAQUE_RED,
          boxShadow: "0 4px 24px rgba(77,13,16,0.10)",
        }}
      >
        <div
          className="rounded-xl border px-7 py-6"
          style={{ borderColor:`${NUFE_RED}30`,
                   backgroundColor: "rgba(255,255,255,0.01)"
        }}
        >
          <div className="text-center mb-6">
            <h1
              className="text-4xl tracking-wide"
              style={{
                color: NUFE_RED,
                fontFamily: "var(--font-calligraphy)",
              }}
            >
              财问
            </h1>
            <p className="mt-1 text-sm" style={{ color: "#8B7355" }}>
              {t("Create your account")}
            </p>
          </div>

          {/* First-user notice */}
          {!checkingFirst && isFirst && (
            <div className="mb-4 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-600">
              <strong>First user:</strong> {t("First user notice")}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 用户名 */}
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

            {/* 密码 */}
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
                autoComplete="new-password"
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
              <p className="mt-1 text-xs" style={{ color: "#fff" }}>
                {t("At least 8 characters")}
              </p>
            </div>

            {/* 确认密码 */}
            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium mb-1.5"
                style={{ color: "#5C4033" }}
              >
                确认密码
              </label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg border
                           bg-white text-[var(--foreground)]
                           placeholder:text-gray-400
                           focus:outline-none focus:ring-2 focus:border-transparent
                           transition-shadow text-sm"
                style={{
                  borderColor: `${NUFE_RED}30`,
                  "--tw-ring-color": NUFE_RED,
                } as React.CSSProperties}
                placeholder="请再次输入密码"
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
              {loading ? t("Creating account…") : t("Create account")}
            </StarBorder>
          </form>
        </div>
      </div>

      {/* 登录入口 — 整行改用书法字体，与「财问」标题统一 */}
      <p
        className="mt-5 text-center text-base"
        style={{
          color: "rgba(255,255,255,0.85)",
          fontFamily: "var(--font-calligraphy)",
        }}
      >
        {t("Already have an account?")}{" "}
        <Link
          href="/login"
          className="inline-block px-3 py-1 rounded-md hover:opacity-85 transition-opacity"
          style={{
            color: NUFE_RED,
            backgroundColor: "#fff",
          }}
        >
          {t("Sign in")}
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
      </div>
    </div>
  );
}
