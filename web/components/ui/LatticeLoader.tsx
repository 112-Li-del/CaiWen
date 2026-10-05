"use client";

import React from "react";

/**
 * LatticeLoader — 3x3/4x4 格阵加载指示器，运行时按 pattern 依次点亮格子，
 * 结束后整层淡出、浮现 ✓（done）或 ✕（error）标记格。
 *
 * 参考 React Bits 同名组件 https://www.reactbits.dev/micro/lattice-loader，
 * 针对本项目做了以下适配：
 *  1. 裁掉原版的 label/doneLabel/errorLabel 三态文字轮换、内置计时器
 *     （setInterval 每 100ms 写 DOM）和 sr-only 播报——财问调用处自己渲染
 *     「思考 · 用时 Ns」文本，组件只负责格阵动画与完成/出错标记。
 *     顺带把逐帧 JS 开销降为零：动画纯 CSS keyframes（见 globals.css 的
 *     dt-lattice-on*），不引入 motion 依赖，符合项目既有结论
 *     「能用 CSS keyframes 就不要用逐帧 JS」。
 *  2. 样式由独立 .css 改为 Tailwind 类 + 内联样式；原版用 data-* 属性选择器
 *     切换状态（data-status/data-on/data-hole/data-lit），这里 status 是
 *     React prop，直接条件渲染，不需要属性选择器。keyframes 按 globals.css
 *     约定加 dt- 前缀（放 globals.css 而不是 tailwind.config.js，HMR 免重启）。
 *  3. shape 的圆角用内联 borderRadius：动态 px 值的 rounded-[...] 类
 *     Tailwind JIT 生成不了。
 *  4. 默认色改南财红系：运行态默认 var(--primary)。
 *  5. prefers-reduced-motion 降级保留：globals.css 里用 !important 压过
 *     内联 animation 简写（内联样式优先级高于类，只能靠 !important）。
 *  6. 原版 lit 参数是 0.25|0.35|0.45|0.62 字面量联合类型，这里放宽为 number，
 *     但只有 0.25/0.35/0.45 有对应的低亮度 keyframes，其余值回落到标准亮度。
 */

export type LatticeStatus = "working" | "done" | "error";
export type LatticePatternName =
  | "arrow"
  | "dots"
  | "orbit"
  | "ripple"
  | "snake"
  | "spiral"
  | "sweep"
  | "spin"
  | "rain"
  | "pulse";
export type LatticeGrid = 3 | 4;

export interface LatticePattern {
  /** 格子点亮顺序（格下标），null 表示挖洞不参与动画 */
  cells: (number | null)[];
  /** 一个循环的"拍"数 */
  loop?: number;
  /** 每拍时长倍率 */
  scale?: number;
  /** 峰值亮度档位：0.25/0.35/0.45 有对应 keyframes，其余为标准亮度 */
  lit?: number;
}

export interface LatticeLoaderProps {
  /** working 播放点亮动画；done/error 显示标记格 */
  status?: LatticeStatus;
  /** 预置点亮图案，或传自定义 LatticePattern */
  pattern?: LatticePatternName | LatticePattern;
  grid?: LatticeGrid;
  /** 格子形状：round 圆点 / square 圆角方块 */
  shape?: "square" | "round";
  /** 运行态格子颜色 */
  color?: string;
  /** done 标记颜色 */
  doneColor?: string;
  /** error 标记颜色 */
  errorColor?: string;
  /** 单格边长 px */
  cellSize?: number;
  /** 格间距 px */
  gap?: number;
  /** 一拍的时长基准 px（乘 scale 得每拍毫秒） */
  step?: number;
  /** 未点亮格子的不透明度 */
  idleOpacity?: number;
  /** 格子外发光 */
  glow?: boolean;
  /** 外发光颜色，缺省跟 color 走 */
  glowColor?: string;
  className?: string;
  style?: React.CSSProperties;
}

type ResolvedPattern = {
  cells: (number | null)[];
  loop: number;
  scale: number;
  lit?: number;
};

const PATTERNS: Record<
  LatticePatternName,
  Partial<Record<LatticeGrid, ResolvedPattern>>
> = {
  arrow: { 3: { cells: [1, 2, 3, 0, 1, 2, 1, 2, 3], loop: 7.2, scale: 1 } },
  dots: { 3: { cells: [0, 1, 2, 0, 1, 2, 0, 1, 2], loop: 3, scale: 2.4 } },
  ripple: { 3: { cells: [2, 1, 2, 1, 0, 1, 2, 1, 2], loop: 4.8, scale: 1.5 } },
  spiral: {
    3: { cells: [0, 1, 2, 7, 8, 3, 6, 5, 4], loop: 9, scale: 1.2, lit: 0.35 },
  },
  orbit: {
    3: { cells: [0, 1, 2, 7, null, 3, 6, 5, 4], loop: 8, scale: 1.2 },
    4: {
      cells: [0, 1, 2, 3, 11, null, null, 4, 10, null, null, 5, 9, 8, 7, 6],
      loop: 6,
      scale: 1.2,
      lit: 0.45,
    },
  },
  snake: {
    3: { cells: [0, 1, 2, 5, 4, 3, 6, 7, 8], loop: 9, scale: 1, lit: 0.35 },
    4: {
      cells: [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12],
      loop: 16,
      scale: 1,
      lit: 0.25,
    },
  },
  sweep: {
    4: {
      cells: [0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6],
      loop: 5,
      scale: 1,
      lit: 0.45,
    },
  },
  spin: {
    4: {
      cells: [0, 0, 1, 1, 0, 0, 1, 1, 3, 3, 2, 2, 3, 3, 2, 2],
      loop: 4,
      scale: 1.6,
      lit: 0.35,
    },
  },
  rain: {
    4: {
      cells: [0, 2, 1, 3, 1, 3, 2, 4, 2, 4, 3, 5, 3, 5, 4, 6],
      loop: 4,
      scale: 1.2,
      lit: 0.35,
    },
  },
  pulse: {
    4: {
      cells: [2, 1, 1, 2, 1, 0, 0, 1, 1, 0, 0, 1, 2, 1, 1, 2],
      loop: 2.4,
      scale: 2.5,
      lit: 0.45,
    },
  },
};
const DEFAULT_PATTERN: Record<LatticeGrid, LatticePatternName> = {
  3: "orbit",
  4: "sweep",
};
/** done=✓ error=✕ 的标记格下标 */
const MARKS: Record<LatticeGrid, Record<"done" | "error", number[]>> = {
  3: { done: [2, 3, 5, 7], error: [0, 2, 4, 6, 8] },
  4: { done: [7, 8, 10, 13], error: [0, 3, 5, 6, 9, 10, 12, 15] },
};

const resolvePattern = (
  pattern: LatticePatternName | LatticePattern,
  grid: LatticeGrid,
): ResolvedPattern => {
  if (typeof pattern === "string") {
    const named = PATTERNS[pattern];
    return (named && named[grid]) ||
      (PATTERNS[DEFAULT_PATTERN[grid]][grid] as ResolvedPattern);
  }
  const cells = Array.from({ length: grid * grid }, (_, i) =>
    pattern.cells[i] ?? null,
  );
  const max = Math.max(0, ...cells.filter((v) => v != null));
  return {
    cells,
    loop: pattern.loop ?? max + 4.2,
    scale: pattern.scale ?? 1,
    lit: pattern.lit ?? 0.62,
  };
};

/** lit 值 → keyframes 后缀（globals.css 里 dt-lattice-on-45/35/25） */
const litSuffix = (lit: number | undefined) => {
  if (lit === 0.45 || lit === 0.35 || lit === 0.25) {
    return `-${Math.round(lit * 100)}`;
  }
  return "";
};

export default function LatticeLoader({
  status = "working",
  pattern = "orbit",
  grid = 3,
  shape = "round",
  color = "var(--primary)",
  doneColor = "#22c55e",
  errorColor = "#ef4444",
  cellSize = 6,
  gap = 2,
  step = 90,
  idleOpacity = 0.15,
  glow = false,
  glowColor = "",
  className = "",
  style,
}: LatticeLoaderProps) {
  const n: LatticeGrid = grid === 4 ? 4 : 3;
  const pat = resolvePattern(pattern, n);
  const d = step * pat.scale;
  const cycle = Math.round(pat.loop * d);
  const working = status === "working";
  const mark = status === "working" ? "done" : status;
  const markCells = MARKS[n][mark];
  const markColor = status === "error" ? errorColor : doneColor;
  const radius =
    shape === "round" ? "50%" : `max(1px, ${cellSize * 0.25}px)`;
  const glowShadow = `0 0 ${cellSize * 1.2}px ${cellSize * 0.12}px ${
    glowColor || color
  }`;
  const gridTemplateColumns = `repeat(${n}, ${cellSize}px)`;

  return (
    <span
      role="status"
      className={`dt-lattice-run inline-flex shrink-0 items-center ${className}`}
      aria-label={working ? "in progress" : mark}
      style={
        {
          "--dt-lattice-idle": idleOpacity,
          ...style,
        } as React.CSSProperties
      }
    >
      {/* 运行层：按 pattern 依次点亮 */}
      <span
        aria-hidden="true"
        className={`grid [grid-area:1/1] transition-opacity duration-200 ${
          working ? "" : "pointer-events-none opacity-0"
        }`}
        style={{ gridTemplateColumns, gap }}
      >
        {pat.cells.map((unit, i) => {
          if (unit == null) {
            // 挖洞格：不参与动画，亮度压到 idle 的 47%
            return (
              <span
                key={i}
                style={{
                  width: cellSize,
                  height: cellSize,
                  borderRadius: radius,
                  background: color,
                  opacity: idleOpacity * 0.47,
                }}
              />
            );
          }
          return (
            <span
              key={i}
              className="dt-lattice-cell"
              style={{
                width: cellSize,
                height: cellSize,
                borderRadius: radius,
                background: color,
                boxShadow: glow ? glowShadow : undefined,
                animation: working
                  ? `dt-lattice-on${litSuffix(pat.lit)} ${cycle}ms cubic-bezier(0.77, 0, 0.175, 1) ${Math.round(unit * d)}ms infinite`
                  : "none",
                opacity: idleOpacity,
              }}
            />
          );
        })}
      </span>

      {/* 标记层：结束后浮现 ✓ / ✕ */}
      <span
        aria-hidden="true"
        className={`grid [grid-area:1/1] transition-[opacity,transform] duration-200 ease-out ${
          working ? "scale-90 opacity-0" : "scale-100 opacity-100"
        }`}
        style={{ gridTemplateColumns, gap, transformOrigin: "center" }}
      >
        {pat.cells.map((_, i) => {
          const on = markCells.includes(i);
          return (
            <span
              key={i}
              style={{
                width: cellSize,
                height: cellSize,
                borderRadius: radius,
                background: on ? markColor : color,
                opacity: on ? 1 : idleOpacity,
                boxShadow: on && glow ? `0 0 ${cellSize * 1.2}px ${cellSize * 0.12}px ${glowColor || markColor}` : undefined,
                transition:
                  "opacity 200ms ease, background-color 200ms ease",
              }}
            />
          );
        })}
      </span>
    </span>
  );
}
