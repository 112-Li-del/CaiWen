"use client";

/**
 * EmotionBall —— 「财问表情球」的 React 包装层
 * ------------------------------------------------------------------
 * 底盘是 `lib/emotion-ball/` 下那套纯原生 ESM 引擎（建 DOM + rAF 心跳，
 * 无框架依赖）。这里只负责三件事：
 *   1. 挂载时创建实例、卸载时 destroy（rAF 心跳是全局共享的，不 destroy 会泄漏）；
 *   2. 把 React 的 `emotion` prop 翻译成引擎的 setEmotion；
 *   3. 提供聊天状态 → 表情 ID 的映射（见 resolveEmotion）。
 *
 * 提示文字沿用引擎内置的打字机（typeline.js），所以这里只传一个空 div 让它接管，
 * 不用 React 再渲染一遍文字——两套渲染源会打架。
 */

import { useEffect, useRef } from "react";
// 引擎是原生 JS，没有类型声明；allowJs 下 webpack 能直接打包，这里只压制 TS 报错。
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { create as createBall } from "@/lib/emotion-ball/engine";

export type EmotionId =
  | "00" | "01" | "02" | "03"
  | "10" | "11" | "12"
  | "20" | "21" | "22";

/** 引擎实例句柄（只用到这俩方法，多余的不暴露） */
interface BallHandle {
  setEmotion: (id: string) => void;
  destroy: () => void;
}

/**
 * 聊天状态 → 表情。阶段名取自后端 stage_start 事件（英文），命中不了就退回流式判断。
 * 注意「欢迎」不在这里：欢迎是进门定时 3s 的临时状态，由聊天页控制，超时后落到这里的待机。
 *
 * 优先级：工作态（思考/检索/回答）> 倾听 > 出错 > 待机。
 * 倾听压过出错是故意的：用户一开口重新打字，说明他在试别的问法，球该转过来听，
 * 而不是继续挂着"哎呀，出错了"。
 */
export function resolveEmotion(args: {
  isStreaming: boolean;
  stage?: string;
  failed?: boolean;
  /** 用户输入框里有字（trim 后非空）——不是聚焦就触发 */
  typing?: boolean;
}): EmotionId {
  const { isStreaming, stage, failed, typing } = args;
  if (!isStreaming) {
    if (typing) return "03";                   // 倾听：用户在打字
    if (failed) return "21";                   // 出错
    return "01";                               // 待机
  }
  const s = (stage || "").toLowerCase();
  if (/retriev|search|知识|rag|embed|index/.test(s)) return "11";  // 检索中
  if (/answer|生成|写|draft|stream/.test(s)) return "12";          // 回答中
  return "10";                                    // 思考中
}

export default function EmotionBall({
  emotion = "01",
  className = "",
  size = 120,
  onPoke,
}: {
  emotion?: EmotionId;
  className?: string;
  /** 球直径（px）。改大时注意父容器是 overflow-hidden，丝带会甩出球外约 0.6×直径，
   *  右上角留的偏移量要跟着加，否则丝带会被容器边缘切掉 */
  size?: number;
  onPoke?: (dir: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const ballRef = useRef<BallHandle | null>(null);
  /* onPoke 走 ref：避免回调变化导致引擎重建（重建会丢入场动画） */
  const pokeRef = useRef(onPoke);
  pokeRef.current = onPoke;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ball = createBall(host, {
      tip: tipRef.current,
      glow: true,
      onPoke: (dir: number) => pokeRef.current?.(dir),
    }) as BallHandle;
    ballRef.current = ball;
    return () => {
      ball.destroy();
      ballRef.current = null;
    };
  }, []);

  useEffect(() => {
    ballRef.current?.setEmotion(emotion);
  }, [emotion]);

  return (
    <div className={`flex flex-col items-center select-none ${className}`}>
      {/* 引擎会把 <svg> 插到容器最前，所以这个 div 只当宿主用 */}
      <div
        ref={hostRef}
        style={{ width: size }}
        className="[&>svg]:w-full [&>svg]:h-auto [&>svg]:overflow-visible"
      />
      <div
        ref={tipRef}
        style={{ maxWidth: size + 40 }}
        className="mt-1 text-center text-[12px] leading-tight text-[var(--muted-foreground)]"
      />
    </div>
  );
}
