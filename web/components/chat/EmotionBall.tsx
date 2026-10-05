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
  | "10" | "11" | "12" | "13"
  | "20";

/** 引擎实例句柄（只用到这俩方法，多余的不暴露） */
interface BallHandle {
  setEmotion: (id: string) => void;
  destroy: () => void;
}

/**
 * 聊天状态 → 表情。阶段名取自后端 stage_start 事件（英文），命中不了就退回流式判断。
 * 注意「欢迎」不在这里：欢迎是进门定时 3s 的临时状态，由聊天页控制，超时后落到这里的待机。
 *
 * 优先级：已开始输出（回答中）> 检索/思考（看阶段名）> 倾听 > 待机。
 *   ① answering 排最前：模型一旦吐出第一个字就是「回答中」，比 stage 名可靠——
 *      后端各能力（问答/解题/写作）的阶段名不统一，但"助手消息有内容"是通用的。
 *   ② 思考态（10）在引擎里自带一条链：开场缩成省略号 → 思考 2.5s → 还没输出就
 *      自动接翻知识库（11）。所以这里只要在开始思考时给 10，剩下的不用管。
 *   ③ 开始输出先给「书写」（13）而不是直接「回答中」：球缩没变出一支钢笔，
 *      划一行再回到中间，2.4s 后引擎自己接上 12（chain），这里同样不用管计时。
 *      一轮里 answering 只从 false 翻到 true 一次，所以笔只落一次。
 * 「出错」表情（21）已退役——拟人化的报错脸对学习场景没帮助，出错交给界面自己
 * 的提示条；所以这里没有 failed 分支，出错时球落回待机。
 */
export function resolveEmotion(args: {
  isStreaming: boolean;
  stage?: string;
  /** 用户输入框里有字（trim 后非空）——不是聚焦就触发 */
  typing?: boolean;
  /** 助手这条消息已经吐出内容（第一个字到了） */
  answering?: boolean;
}): EmotionId {
  const { isStreaming, stage, typing, answering } = args;
  if (!isStreaming) {
    if (typing) return "03";                   // 倾听：用户在打字
    return "01";                               // 待机
  }
  /* 13 = 书写（钢笔落笔），引擎 2.4s 后自动接 12，所以不用在这里计时 */
  if (answering) return "13";
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
      {/* 引擎会把 <svg> 插到容器最前，所以这个 div 只当宿主用。
          svg 整体不吃指针事件，只有球面（.cw-hit）重新开启——球叠在
          输入框上时，被盖住的按钮依然可以点。 */}
      <div
        ref={hostRef}
        style={{ width: size }}
        className="[&>svg]:pointer-events-none [&>svg]:w-full [&>svg]:h-auto [&>svg]:overflow-visible [&_.cw-hit]:pointer-events-auto"
      />
      <div
        ref={tipRef}
        style={{ maxWidth: size + 40 }}
        className="mt-1 text-center text-[12px] leading-tight text-[var(--muted-foreground)]"
      />
    </div>
  );
}
