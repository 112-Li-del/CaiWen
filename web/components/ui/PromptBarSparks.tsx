"use client";

/**
 * React Bits `PromptBar` 粒子特效移植件（原版 src/ts-default/Micro/PromptBar，
 * PromptBar.tsx 的 spark effect 段）。财问用法：快速模式开启时铺在聊天输入
 * 区上，作为「当前走快路径」的状态反馈；关闭即卸载，不留后台。
 *
 * 相比原版改了这几处：
 * 1. **去掉 typing energy 联动**。原版在输入框每次按键时给粒子加速，需要
 *    把按键事件穿进粒子系统；财问的输入状态在 ComposerInput 内部、粒子挂在
 *    ChatComposer 上，为了这点观感去加一层 ref 通道不值。保留的是常驻的
 *    上升 + 闪烁 + 发光（shadowBlur），以及 mount 时的一次爆发。
 * 2. **去掉 motion/react 依赖**：原版整组件用 motion 做 morph，粒子这一段
 *    本来就是裸 canvas + rAF，没有依赖。
 * 3. 颜色默认南财红 #EF4444（原版是紫色 #b39dff），可用 color prop 覆盖。
 * 4. 尺寸跟随容器：ResizeObserver + dpr 上限 2（跟 GridDistortion 一个路子）。
 *
 * 性能画像：canvas 2D、粒子数上限 30、每帧只做 clearRect + 30 次 arc fill。
 * 比登录页 GridDistortion 的全屏 WebGL shader 小两个量级，对 FPS 无感；
 * 页面切到后台时浏览器会自动停掉 rAF，不需要额外处理。
 * prefers-reduced-motion：一把挂都不挂（画布不渲染）。
 */

import { useEffect, useRef } from "react";

type Spark = {
  x: number;
  y: number;
  r: number;
  vy: number;
  sway: number;
  phase: number;
  life: number;
  span: number;
};

export interface PromptBarSparksProps {
  /** 粒子颜色，默认南财红 */
  color?: string;
  /** 粒子数上限，默认 30（跟原版一致） */
  maxParticles?: number;
  className?: string;
}

export default function PromptBarSparks({
  color = "#EF4444",
  maxParticles = 30,
  className = "",
}: PromptBarSparksProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    // 减弱动效偏好：直接不跑（画布保持空白）
    const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduceQuery.matches) return undefined;

    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    let raf = 0;
    let last = performance.now();
    let w = 0;
    let h = 0;
    let due = 0;
    const parts: Spark[] = [];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    // burst=true：初始那批直接散布在容器内；false：从底部边缘补进来
    const spawn = (burst: boolean) => {
      parts.push({
        x: Math.random() * w,
        y: burst ? h * (0.2 + Math.random() * 0.8) : h + 3,
        r: 0.9 + Math.random() * 1.1,
        vy: -(7 + Math.random() * 9),
        sway: (Math.random() - 0.5) * 10,
        phase: Math.random() * Math.PI * 2,
        life: burst ? Math.random() * 1.2 : 0,
        span: 2.4 + Math.random() * 2.4,
      });
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      due += dt;
      while (due > 0.14) {
        due -= 0.14;
        if (parts.length < maxParticles) spawn(false);
      }
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const p = parts[i];
        p.life += dt;
        if (p.life > p.span) {
          parts.splice(i, 1);
          continue;
        }
        const k = p.life / p.span;
        // 慢速闪烁，避免整片一起亮一起暗
        const twinkle =
          0.7 + 0.3 * Math.sin((now / 160) * (1 + p.phase * 0.1) + p.phase);
        p.y += p.vy * dt;
        if (p.y < -4) {
          p.y = h + 3;
          p.x = Math.random() * w;
        }
        // 进出容器边缘时淡入淡出，防止粒子被硬切
        const edge = Math.min(
          1,
          Math.max(0, p.y / 14),
          Math.max(0, (h - p.y) / 14),
        );
        ctx.globalAlpha = Math.min(1, Math.sin(k * Math.PI) * 0.9 * twinkle) * edge;
        ctx.beginPath();
        ctx.arc(
          p.x + Math.sin(now / 900 + p.phase) * p.sway,
          p.y,
          p.r * twinkle,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };

    resize();
    for (let i = 0; i < 26; i += 1) spawn(true);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ctx.clearRect(0, 0, w, h);
    };
  }, [color, maxParticles]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
