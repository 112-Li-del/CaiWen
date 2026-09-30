"use client";

import React from "react";

/**
 * StarBorder — 沿边框流动的星光效果容器。
 *
 * 原理：外层 overflow-hidden 裁切，内部两个 radial-gradient 光点（上/下各一个）
 * 沿水平方向往复移动，最后用一层不透明的内层内容盖住中间，只在边缘缝隙
 * （= thickness 控制的 padding）里露出流动的光。
 *
 * 参考 React Bits 同名组件 https://www.reactbits.dev/animations/star-border，
 * 针对本项目做了以下适配：
 *  1. Tailwind v3 没有 z-1 这个类（默认只有 0/10/20/30/40/50/auto），改用 z-[1]
 *  2. style 移到 {...rest} 之后：原版顺序反了，调用方一旦传 style 就会覆盖掉
 *     padding，导致 thickness 静默失效
 *  3. 圆角改为 radius prop 传入单一类名，避免 rounded-lg 与 rounded-[20px]
 *     同时命中时由 CSS 顺序决定胜负
 *  4. 增加 contentClassName，让内层尺寸/字号跟项目按钮体系对齐
 *  5. 增加 disabled：暂停动画 + 降透明度，并且只在 as="button" 时下发
 *     disabled 属性（传给 a/div 会触发 React 未知属性警告）
 *  6. TSX 化，默认值改为南财红系配色
 *  7. 光点数值比原版更醒目：opacity-70 → 90、渐变 10% → 16%。
 *     原版按 inline-block 小按钮调参，用在 w-full 整行宽按钮上时，
 *     内层遮挡后只剩极窄一条缝（thickness=2 时仅 2px），几乎看不见。
 *     实测 thickness 需 ≥4 才有效果。
 *  8. 增加 contentStyle：字体这类必须内联的属性传不进 className，需单独开口子
 */
export interface StarBorderProps extends React.HTMLAttributes<HTMLElement> {
  /** 渲染成的标签或组件，默认 button */
  as?: React.ElementType;
  /**
   * 原生 button 的 type。
   * 之所以要单独声明：`React.HTMLAttributes<HTMLElement>` 是通用 HTML 属性，
   * 不含 button 专属的 type/value 等，多态组件下必须手动补。
   */
  type?: "button" | "submit" | "reset";
  /** 外层容器附加类名（控制宽度、hover、disabled 视觉等） */
  className?: string;
  /** 外层与内层共用的圆角类名，默认 rounded-[20px] */
  radius?: string;
  /** 内层内容区附加类名（控制内边距、字号、字重等） */
  contentClassName?: string;
  /**
   * 内层内容区附加内联样式。
   * 存在的原因：内层 div 的 style 是组件内部拼装的（background/color/borderColor），
   * className 传不进字体这类必须内联的属性，故开一个口子。
   * 典型用途：fontFamily: "var(--font-calligraphy)" 接书法字体。
   */
  contentStyle?: React.CSSProperties;
  /** 光点颜色，radial-gradient 向 transparent 渐变 */
  color?: string;
  /** 一次扫动的时长，CSS 时间字符串，如 "6s" */
  speed?: string;
  /** 光带厚度，即外层上下 padding，单位 px */
  thickness?: number;
  /** 内层背景色 */
  backgroundColor?: string;
  /** 内层文字色 */
  textColor?: string;
  /** 内层静态边框色 */
  borderColor?: string;
  /**
   * 光带底色，即外层背景色——只有 thickness 那圈会露出来。
   * 必须是深色：缝后面透出的是卡片/页面背景，浅色底 + 浅色光点对比度接近零，
   * 会完全看不见。React Bits 原版没有这个参数，因为它的 demo 是黑底页面。
   */
  trackColor?: string;
  /** 禁用：暂停光点动画并降低不透明度 */
  disabled?: boolean;
  children?: React.ReactNode;
}

export default function StarBorder({
  as: Component = "button",
  className = "",
  radius = "rounded-[20px]",
  contentClassName = "",
  contentStyle,
  color = "#F7DCA0",
  speed = "6s",
  thickness = 2,
  backgroundColor = "#8B1A2B",
  textColor = "#ffffff",
  borderColor = "transparent",
  trackColor = "#1a1a1a",
  disabled = false,
  children,
  ...rest
}: StarBorderProps) {
  // 只有原生 button 接受 disabled 属性；as={Link} 等场景不能下发
  const isNativeButton = Component === "button";

  return (
    <Component
      className={`relative inline-block overflow-hidden ${radius} ${
        disabled ? "opacity-60 cursor-not-allowed" : ""
      } ${className}`}
      {...rest}
      // style 必须在 {...rest} 之后，否则调用方传入的 style 会覆盖 padding
      style={{
        padding: `${thickness}px 0`,
        backgroundColor: trackColor,
        ...rest.style,
      }}
      {...(isNativeButton ? { disabled } : {})}
    >
      <div
        aria-hidden="true"
        className="absolute w-[300%] h-[50%] opacity-100 bottom-[-11px] right-[-250%] rounded-full animate-star-movement-bottom z-0"
        style={{
          background: `radial-gradient(circle, ${color} 0%, ${color} 8%, transparent 28%)`,
          animationDuration: speed,
          animationPlayState: disabled ? "paused" : "running",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute w-[300%] h-[50%] opacity-100 top-[-10px] left-[-250%] rounded-full animate-star-movement-top z-0"
        style={{
          background: `radial-gradient(circle, ${color} 0%, ${color} 8%, transparent 28%)`,
          animationDuration: speed,
          animationPlayState: disabled ? "paused" : "running",
        }}
      />
      <div
        className={`relative z-[1] border text-center ${radius} ${contentClassName}`}
        style={{ background: backgroundColor, color: textColor, borderColor, ...contentStyle }}
      >
        {children}
      </div>
    </Component>
  );
}
