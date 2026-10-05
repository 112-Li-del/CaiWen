"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * GooeyButton — 快速回答开关，点击效果按 ReactBits GooeyNav 逐字移植
 * (https://www.reactbits.dev/components/gooey-nav，源码 GooeyNav.jsx/.css)。
 *
 * 点击（激活）时：药丸按官方 pill 动画（--linear-ease 过冲曲线）弹入，
 * 同时 15 颗彩色气泡从按钮四周 ~90px 的圆环上带旋转螺旋汇聚进药丸，
 * 全程过 goo 滤镜（blur + alpha 锐化）互相融合成"液态"——即官方 demo
 * 的点击效果。取消时药丸缩回、气泡自然收敛消散。
 *
 * 相比官方 GooeyNav 改了哪几处（移植约定：差异写头部）：
 * 1. 官方是导航列表（药丸要飞到被点条目、复制其文字），这里是单按钮开关：
 *    药丸固定 inset-0，不需要 updateEffectPosition / ResizeObserver / 键盘
 *    代理（<button> 原生响应 Enter/Space）。粒子发生器 noise/getXY/
 *    createParticle 与官方逐字一致，参数用官方默认值。
 * 2. goo 滤镜：官方用 CSS `blur(7px) contrast(100)` + lighten + 黑垫底，
 *    只适合白形状贴暗底（demo 全是暗底；亮底上 lighten 会把形状洗没），
 *    且 contrast 会把品牌色洗成纯红/纯白。这里换成 SVG
 *    feGaussianBlur + feColorMatrix（只锐化 alpha，不动 RGB）+ feBlend，
 *    南财红 var(--primary) 在明暗主题下都原色保留，也不需要垫底色块。
 * 3. SVG filter 默认作用域只有元素框的 ±10%，90px 外的汇聚粒子会被整颗
 *    裁掉——显式放大到 x -120% / y -250% / 340%×600%（上一版效果出不来
 *    的主因之一，另一个是按钮 overflow-hidden，本版已去掉）。
 * 4. 粒子颜色官方是 4 档白，这里定义成 --primary 的 4 档深浅
 *    （.dt-gooey-filter 的 --color-1..4，见 globals.css）。
 * 5. 粒子/气泡从 20px 缩到 14px（官方导航条目高约 40px，本按钮 29px，
 *    等比缩小才保持官方 demo 的块头比例）；其余 CSS（含两段 keyframes、
 *    -350ms 负延迟、官方缓动）照抄，仅改 dt- 前缀。
 */

/* 官方默认值（GooeyNav props）：主动画 600ms，15 颗粒子，汇聚距离
 * [外 90px, 内 10px]，旋转随机因子 100，时间抖动 ±300ms，颜色轮换序列。 */
const ANIMATION_TIME = 600;
const PARTICLE_COUNT = 15;
const PARTICLE_DISTANCES: [number, number] = [90, 10];
const PARTICLE_R = 100;
const TIME_VARIANCE = 300;
const COLORS = [1, 2, 3, 1, 2, 3, 1, 4];

interface GooeyButtonProps {
  active: boolean;
  onToggle: () => void;
  label: string;
  title?: string;
  icon?: ReactNode;
  /** Hide the label, keep the dot only (very narrow toolbars). */
  compact?: boolean;
  /** Unique SVG filter id if more than one instance is ever mounted. */
  filterId?: string;
}

/* ---- 粒子发生器（官方 noise/getXY/makeParticles 逐字对应）----------------
   放在模块层而不是组件体内：随机数只允许出现在点击事件这条命令式路径上，
   渲染路径保持纯函数（react-hooks/purity 规则也据此放行）。 */

function noise(n = 1) {
  return n / 2 - Math.random() * n;
}

function getXY(distance: number, pointIndex: number, totalPoints: number): [number, number] {
  const angle = ((360 + noise(8)) / totalPoints) * pointIndex * (Math.PI / 180);
  return [distance * Math.cos(angle), distance * Math.sin(angle)];
}

function spawnParticles(
  goo: HTMLSpanElement,
  spawnTimers: number[],
  removalTimers: number[],
) {
  /* 重放前清场：掐掉还没落地的生成定时器 + 移除上一轮粒子 */
  spawnTimers.forEach(clearTimeout);
  spawnTimers.length = 0;
  goo.querySelectorAll(".dt-gooey-particle").forEach((p) => p.remove());

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    /* 以下与官方 makeParticles 循环体逐字对应 */
    const t = ANIMATION_TIME * 2 + noise(TIME_VARIANCE * 2);
    const start = getXY(PARTICLE_DISTANCES[0], PARTICLE_COUNT - i, PARTICLE_COUNT);
    const end = getXY(PARTICLE_DISTANCES[1] + noise(7), PARTICLE_COUNT - i, PARTICLE_COUNT);
    const scale = 1 + noise(0.2);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const rotate = noise(PARTICLE_R / 10);
    const particleRotate =
      rotate > 0 ? (rotate + PARTICLE_R / 20) * 10 : (rotate - PARTICLE_R / 20) * 10;

    spawnTimers.push(
      window.setTimeout(() => {
        const particle = document.createElement("span");
        particle.className = "dt-gooey-particle";
        particle.style.setProperty("--start-x", `${start[0]}px`);
        particle.style.setProperty("--start-y", `${start[1]}px`);
        particle.style.setProperty("--end-x", `${end[0]}px`);
        particle.style.setProperty("--end-y", `${end[1]}px`);
        particle.style.setProperty("--time", `${t}ms`);
        particle.style.setProperty("--scale", `${scale}`);
        particle.style.setProperty("--color", `var(--color-${color}, var(--primary))`);
        particle.style.setProperty("--rotate", `${particleRotate}deg`);

        const point = document.createElement("span");
        point.className = "dt-gooey-point";
        particle.appendChild(point);
        goo.appendChild(particle);

        removalTimers.push(window.setTimeout(() => particle.remove(), t));
      }, 30),
    );
  }
}

export default function GooeyButton({
  active,
  onToggle,
  label,
  title,
  icon,
  compact = false,
  filterId = "cw-gooey-button-filter",
}: GooeyButtonProps) {
  /* goo 层：药丸 + 每次点击临时塞进来的粒子（官方就是命令式 createElement，
   * 随机数只出现在点击事件里，不参与渲染，SSR/hydration 无涉）。 */
  const gooRef = useRef<HTMLSpanElement>(null);
  const spawnTimersRef = useRef<number[]>([]);
  const removalTimersRef = useRef<number[]>([]);

  useEffect(
    () => () => {
      spawnTimersRef.current.forEach(clearTimeout);
      removalTimersRef.current.forEach(clearTimeout);
    },
    [],
  );

  const handleClick = () => {
    /* 官方只在"切到新条目"时放粒子；这里是开关——点亮时放，
     * 取消时不放（在飞的气泡会自己收敛进原点消散）。 */
    if (
      !active &&
      gooRef.current &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      spawnParticles(gooRef.current, spawnTimersRef.current, removalTimersRef.current);
    }
    onToggle();
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={handleClick}
      title={title}
      /* 不能 overflow-hidden：粒子要从按钮外 ~90px 处飞进来。
         z-30 让飞出场压过工具栏相邻控件（goo 层自身 pointer-events-none）。 */
      className="relative z-30 flex shrink-0 items-center rounded-full border py-[5px] pl-[11px] pr-3 text-[11px] font-medium leading-none outline-none transition-[color,border-color,background-color] duration-200 focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40"
      style={{
        color: active ? "var(--primary-foreground)" : "var(--muted-foreground)",
        borderColor: active
          ? "var(--primary)"
          : "color-mix(in srgb, var(--border) 80%, transparent)",
        backgroundColor: active
          ? "transparent"
          : "color-mix(in srgb, var(--muted) 30%, transparent)",
        gap: compact ? 0 : 6,
      }}
    >
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          {/* 作用域必须放大：默认 -10%~120% 会把 90px 外的粒子裁掉。
              color-interpolation-filters sRGB：默认 linearRGB 会让品牌色
              经 feBlend 后偏色。 */}
          <filter
            id={filterId}
            x="-120%"
            y="-250%"
            width="340%"
            height="600%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation="7 7" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9"
              result="goo"
            />
            <feBlend in="SourceGraphic" in2="goo" />
          </filter>
        </defs>
      </svg>

      {/* Goo 层：药丸 + 汇聚粒子 + 常驻小圆点，全部互相融合 */}
      <span
        ref={gooRef}
        className="dt-gooey-filter"
        style={{ filter: `url(#${filterId})` }}
        aria-hidden="true"
      >
        {/* 药丸：激活时按官方 pill 动画弹入，取消时缩回（globals.css） */}
        <span className={`dt-gooey-pill${active ? " active" : ""}`} />
        {/* 常驻小圆点：关态的"开关魂"，点亮时被药丸吞掉 */}
        <span
          className="dt-gooey-dot"
          style={{
            backgroundColor: active
              ? "var(--primary)"
              : "color-mix(in srgb, var(--muted-foreground) 45%, transparent)",
          }}
        />
      </span>

      {/* Foreground content (above the goo layer). */}
      {!compact && (
        <span
          className="relative z-10 flex items-center"
          style={{ gap: 6, paddingLeft: 10 }}
        >
          {icon}
          <span className="whitespace-nowrap">{label}</span>
        </span>
      )}
      {compact && (
        <span
          aria-hidden="true"
          className="relative z-10 block"
          style={{ width: 7 }}
        />
      )}
    </button>
  );
}
