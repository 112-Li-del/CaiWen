"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { gsap } from "gsap";

/**
 * StrokeText — 逐字"描边勾勒 → 墨色填充"的 SVG 文字入场动画。
 *
 * 原理：同一个词渲染两遍 SVG <text>——一遍只有描边（fill="none"），
 * 一遍只有填充（stroke="none"）。用 strokeDasharray / strokeDashoffset
 * 把描边当成路径"画"出来（GSAP 补间 offset 从 dash → 0，配合 per-char stagger），
 * 描边画完后再让填充进场：fillMode="wipe" 时用 clipPath 里一个 rect
 * 的 width 从左扫到右，="fade" 时整字淡入。
 *
 * 参考 React Bits 同名组件
 * https://www.reactbits.dev/text-animations/stroke-text
 * 针对本项目做了以下适配：
 *  1. TSX 化，样式由独立 .css 改为 Tailwind 类（本项目组件统一 TSX + Tailwind）
 *  2. 新增 as prop：根元素可选，本项目要用 h1 承载「财问」，否则丢标题语义
 *  3. **移除 ScrollTrigger**：原版无条件 import 'gsap/ScrollTrigger' 并注册，
 *     本项目只用 mount 触发，不引入该插件可省一大块 bundle
 *  4. **新增 dashLength prop（关键）**：描边动画靠 dasharray 把整条轮廓藏在
 *     dash 之外，dash 必须 ≥ 字形轮廓周长，否则动画开始前字形就已部分可见
 *     （表现为漏画 + 断线）。原版 `fontSize * 7` 是按拉丁字母估的，
 *     汉字笔画多得多，实测需要 `fontSize * 14` 左右。
 *     估大了只是动画提前画完、尾部有一小段空档；估小了会画坏——宁大勿小。
 *  5. fontSize 支持字符串（内部取 Number 用于 dash 与高度计算）
 *  6. 沿用 prefers-reduced-motion 降级：直接呈现终态，不做绘制动画
 *
 * ⚠️ 字体相关：组件只给 <text> 设 fontSize / fontWeight / letterSpacing，
 *    **不设 font-family**，所以字体从根元素继承。用法是把
 *    `fontFamily: "var(--font-calligraphy)"` 写在容器 style 上——
 *    SVG 里 CSS 变量能正常解析，没有 ParticleText（canvas）那个坑。
 *
 * ⚠️ 注意 letterSpacing 默认 -4（按 128px 拉丁字调的），中文字形不要沿用，
 *    本项目显式传小正值。
 */
export interface StrokeTextProps {
  /** 待渲染的文字，逐字拆分动画 */
  text?: string;
  /** 描边（勾勒）颜色 */
  strokeColor?: string;
  /** 填充（落墨）颜色 */
  fillColor?: string;
  /** 描边宽度，单位同 SVG 用户坐标 */
  strokeWidth?: number;
  /** 单字描边绘制时长，单位秒 */
  drawDuration?: number;
  /** 描边画完到填充进场之间的间隔，单位秒 */
  fillDelay?: number;
  /** 逐字延迟，单位秒 */
  stagger?: number;
  /** GSAP 缓动 */
  ease?: string;
  /** 触发时机。本项目未接入 ScrollTrigger，故没有 "scroll" */
  trigger?: "mount" | "hover" | "loop";
  /** 填充进场方式：淡入 / 从左到右擦除 / 不填充 */
  fillMode?: "fade" | "wipe" | "none";
  /**
   * SVG 内的字号。视觉高度 ≈ fontSize × 1.3（因为 svg 高度被写死成这个值，
   * 且 viewBox 通常是"高度受限"缩放），所以这个数约等于"标题多大"的旋钮。
   */
  fontSize?: number | string;
  /** 字重。书法字体只有 400，不要传 500+ */
  fontWeight?: number | string;
  /** 字距，单位同 SVG 用户坐标 */
  letterSpacing?: number | string;
  /** 从最后一个字开始错峰 */
  reverse?: boolean;
  /**
   * dasharray 长度。必须 ≥ 单字轮廓周长，汉字建议 fontSize × 14 以上。
   * 不传则回落到原版的 fontSize × 7（拉丁字形适用，汉字会画坏）。
   */
  dashLength?: number;
  /** 根元素标签或组件，默认 span */
  as?: React.ElementType;
  /** 根元素附加类名 */
  className?: string;
  /** 根元素附加内联样式（本项目用它接书法字体） */
  style?: React.CSSProperties;
}

const DEFAULT_TEXT = "Draw Attention";

/**
 * SSR 下 useLayoutEffect 会触发 React 警告（"does nothing on the server"）。
 * App Router 里客户端组件同样会被 server render，故做同构兜底。
 * 这里必须用 layout effect 而非 useEffect：bbox 测量决定 viewBox，
 * 用 useEffect 会先渲染一帧错误的 fallback viewBox，肉眼可见跳动。
 */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export default function StrokeText({
  text = DEFAULT_TEXT,
  strokeColor = "#A78BFA",
  fillColor = "#F8FAFC",
  strokeWidth = 1.4,
  drawDuration = 1.6,
  fillDelay = 0.2,
  stagger = 0.05,
  ease = "power2.out",
  trigger = "mount",
  fillMode = "wipe",
  fontSize = 128,
  fontWeight = 800,
  letterSpacing = -4,
  reverse = false,
  dashLength,
  as: Component = "span",
  className = "",
  style = {},
}: StrokeTextProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const strokeTextRef = useRef<SVGTextElement | null>(null);
  const wipeRectRef = useRef<SVGRectElement | null>(null);

  const [box, setBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const rawId = useId();
  const wipeId = `stroke-text-wipe-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const characters = useMemo(() => Array.from(String(text ?? "")), [text]);

  // fontSize 可能是字符串（如 "128px"），内部计算统一转成数字
  const fs = typeof fontSize === "number" ? fontSize : parseFloat(String(fontSize)) || 128;
  const dash = dashLength ?? Math.max(fs * 7, 200);

  const fontStyle = useMemo(
    () => ({
      fontSize: `${fontSize}px`,
      fontWeight,
      letterSpacing: `${letterSpacing}px`,
    }),
    [fontSize, fontWeight, letterSpacing],
  );

  // 测量真实 bbox 作为 viewBox：字体加载完会再量一次
  useIsomorphicLayoutEffect(() => {
    const node = strokeTextRef.current;
    if (!node) return undefined;

    let cancelled = false;

    const measure = () => {
      if (cancelled || !strokeTextRef.current) return;
      let bbox;
      try {
        bbox = strokeTextRef.current.getBBox();
      } catch {
        return;
      }
      if (!bbox || !bbox.width) return;

      const pad = Math.max(Number(strokeWidth) || 1, fs * 0.1);
      const next = {
        x: bbox.x - pad,
        y: bbox.y - pad,
        width: bbox.width + pad * 2,
        height: bbox.height + pad * 2,
      };

      setBox((prev) =>
        prev &&
        Math.abs(prev.x - next.x) < 0.5 &&
        Math.abs(prev.width - next.width) < 0.5 &&
        Math.abs(prev.y - next.y) < 0.5
          ? prev
          : next,
      );
    };

    measure();
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(measure).catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [characters, fs, fontWeight, letterSpacing, strokeWidth]);

  useEffect(() => {
    const root = rootRef.current;
    if (typeof window === "undefined" || !root || !box) return undefined;

    const strokes = gsap.utils.toArray<SVGTSpanElement>(
      root.querySelectorAll("[data-stroke-char]"),
    );
    const fills = gsap.utils.toArray<SVGTSpanElement>(
      root.querySelectorAll("[data-fill-char]"),
    );
    const wipe = wipeRectRef.current;
    if (!strokes.length) return undefined;

    const fillEnabled = fillMode !== "none";
    const useWipe = fillEnabled && fillMode === "wipe";
    const fillDuration = Math.max(0.4, drawDuration * 0.5);
    const staggerConfig = reverse ? { each: stagger, from: "end" as const } : stagger;
    const targets = [...strokes, ...fills, wipe].filter(Boolean);

    const setStart = () => {
      gsap.killTweensOf(targets);
      gsap.set(strokes, { strokeDasharray: dash, strokeDashoffset: dash });
      gsap.set(fills, { opacity: useWipe ? 1 : 0 });
      if (wipe) gsap.set(wipe, { attr: { width: 0 } });
    };

    const setEnd = () => {
      gsap.killTweensOf(targets);
      gsap.set(strokes, { strokeDasharray: dash, strokeDashoffset: 0 });
      gsap.set(fills, { opacity: fillEnabled ? 1 : 0 });
      if (wipe) gsap.set(wipe, { attr: { width: fillEnabled ? box.width : 0 } });
    };

    const prefersReducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReducedMotion) {
      setEnd();
      return () => gsap.killTweensOf(targets);
    }

    const build = () => {
      setStart();
      const tl = gsap.timeline({
        paused: true,
        repeat: trigger === "loop" ? -1 : 0,
        repeatDelay: trigger === "loop" ? 0.9 : 0,
        defaults: { overwrite: "auto" },
      });

      tl.to(strokes, { strokeDashoffset: 0, duration: drawDuration, ease, stagger: staggerConfig }, 0);

      if (useWipe && wipe) {
        tl.to(
          wipe,
          { attr: { width: box.width }, duration: fillDuration, ease: "power2.inOut" },
          drawDuration + fillDelay,
        );
      } else if (fillEnabled) {
        tl.to(
          fills,
          { opacity: 1, duration: fillDuration, ease: "power2.out", stagger: staggerConfig },
          drawDuration + fillDelay,
        );
      }

      return tl;
    };

    let timeline: gsap.core.Timeline | null = null;
    let removeHover: (() => void) | null = null;

    if (trigger === "hover") {
      setEnd();
      const play = () => {
        timeline?.kill();
        timeline = build();
        timeline.play(0);
      };
      root.addEventListener("pointerenter", play);
      removeHover = () => root.removeEventListener("pointerenter", play);
    } else {
      timeline = build();
      timeline.play(0);
    }

    return () => {
      removeHover?.();
      timeline?.kill();
      gsap.killTweensOf(targets);
    };
  }, [box, dash, drawDuration, fillDelay, stagger, ease, trigger, fillMode, reverse]);

  const viewBox = box
    ? `${box.x} ${box.y} ${box.width} ${box.height}`
    : `0 ${-fs} 600 ${fs * 1.3}`;

  return (
    <Component
      ref={rootRef}
      className={`block w-full leading-[0] ${className}`.trim()}
      style={
        {
          ...style,
          "--stroke-text-height": `${Math.round(fs * 1.3)}px`,
        } as React.CSSProperties
      }
      role="img"
      aria-label={String(text ?? "")}
    >
      <svg
        className="block w-full h-[var(--stroke-text-height)] select-none"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {fillMode === "wipe" && box && (
          <defs>
            <clipPath id={wipeId} clipPathUnits="userSpaceOnUse">
              <rect ref={wipeRectRef} x={box.x} y={box.y} width={0} height={box.height} />
            </clipPath>
          </defs>
        )}

        <text
          ref={strokeTextRef}
          x="0"
          y="0"
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={fontStyle}
        >
          {characters.map((char, index) => (
            <tspan data-stroke-char key={`s-${index}`}>
              {char}
            </tspan>
          ))}
        </text>

        <text
          x="0"
          y="0"
          fill={fillColor}
          stroke="none"
          style={fontStyle}
          clipPath={fillMode === "wipe" && box ? `url(#${wipeId})` : undefined}
        >
          {characters.map((char, index) => (
            <tspan data-fill-char key={`f-${index}`}>
              {char}
            </tspan>
          ))}
        </text>
      </svg>
    </Component>
  );
}
