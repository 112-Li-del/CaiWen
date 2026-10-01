/**
 * ShinyText — 文字上掠过一道高光
 *
 * 移植自 React Bits 的 ShinyText
 * （https://www.reactbits.dev/text-animations/shiny-text）。
 *
 * 原理：把线性渐变（基底色 → 高光色 → 基底色）当作文字背景，用
 * `background-clip: text` + `-webkit-text-fill-color: transparent` 让文字本身
 * 变成渐变的镂空窗口；再让 `background-position` 从 150% 扫到 -50%，高光条
 * 就像从文字上掠过。位移量恰好等于背景图宽度（backgroundSize 200%，位移 2 倍
 * 容器宽），所以循环处无缝，看不出起点。
 *
 * 与官方实现的两处差异（有意为之）：
 *
 *  1. 官方用 `motion/react` 的 useAnimationFrame 每帧 setMotionValue 来驱动
 *     background-position —— 每帧一次 JS 执行 + 一次 style 写入。这里改为纯
 *     CSS keyframes：同一套渐变、同一条 150% → -50% 映射，视觉完全一致，且省掉
 *     每帧的 JS 执行与 React / motion 开销（也因此本项目无需引入 `motion` 依赖）。
 *
 *     ⚠️ 别误以为改完就"零成本"：background-position **不是**合成器属性
 *     （transform / opacity 才是），CSS 动画每帧仍需主线程做一次 style 计算
 *     并 repaint 该元素。只是重绘范围就两行文字（约 300×28px），
 *     相对登录页背景那个全屏 WebGL shader 可以完全忽略。
 *
 *  2. 官方的 `delay`（每轮之间的停顿）未实现：CSS keyframe 的**选择器位置**
 *     不能用 CSS 变量（`var(--x) %` 非法），做可变停顿比例只能在运行时注入
 *     <style> 标签，代价大于收益。默认 delay=0 即全程匀速扫动；确实想放缓，
 *     调大 speed 即可。
 *
 * 调用方注意：`color` 是**非高光区**的文字色（官方默认 #b5b5b5 灰），
 * `shineColor` 才是扫过的那道高光。
 */
import React from "react";

export interface ShinyTextProps {
  /** 文字内容 */
  text: string;
  /** 基底（高光之外）的文字颜色 */
  color?: string;
  /** 扫过时的高光颜色 */
  shineColor?: string;
  /**
   * 渐变角度，单位 deg。
   * 原版把这个 prop 叫 `spread`，但它直接充当 linear-gradient 的第一个参数，
   * 实际语义就是角度，保留原名以便与官方文档对上。
   */
  spread?: number;
  /** 扫完一趟所需秒数 */
  speed?: number;
  /** 扫动方向 */
  direction?: "left" | "right";
  /** 暂停动画（停在当前位置） */
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export default function ShinyText({
  text,
  color = "#b5b5b5",
  shineColor = "#ffffff",
  spread = 120,
  speed = 2,
  direction = "left",
  disabled = false,
  className = "",
  style,
}: ShinyTextProps) {
  return (
    <span
      className={`dt-shiny-text inline-block ${className}`.trim()}
      style={{
        backgroundImage: `linear-gradient(${spread}deg, ${color} 0%, ${color} 35%, ${shineColor} 50%, ${color} 65%, ${color} 100%)`,
        backgroundSize: "200% auto",
        backgroundRepeat: "repeat",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        // 基底字色：同时也是 prefers-reduced-motion 降级时取回的颜色
        color,
        // 文字本身透明，透出下方被裁剪的渐变
        WebkitTextFillColor: "transparent",
        animationName: "dt-shiny-text",
        animationDuration: `${speed}s`,
        animationTimingFunction: "linear",
        animationIterationCount: "infinite",
        animationDirection: direction === "right" ? "reverse" : "normal",
        animationPlayState: disabled ? "paused" : "running",
        // 调用方覆盖放最后：避免像官方那样被前置的展开覆盖掉关键属性
        ...style,
      }}
    >
      {text}
    </span>
  );
}
