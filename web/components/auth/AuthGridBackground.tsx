"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";

/**
 * 登录 / 注册页背景：
 *  - 底层始终是一张静态图（login_bg2.png），作为加载中与各种降级场景的兜底；
 *  - 仅在“鼠标可悬停设备 + 宽度足够 + 未开启系统减弱动效 + 支持 WebGL”时，
 *    才懒加载 three 版 GridDistortion 叠在静态图之上；
 *  - 触屏 / 窄屏 / 不支持 WebGL / 运行时报错时，自动只保留静态图，保证登录入口
 *    在任何设备上都可用（全校上线的安全兜底）。
 *  - 背景层 pointer-events-none，扭曲效果通过 window 鼠标事件追踪，不会拦截
 *    登录表单的任何点击。
 */

const GridDistortion = dynamic(
  () => import("@/components/common/GridDistortion"),
  {
    ssr: false,
    loading: () => null,
  },
);

interface AuthGridBackgroundProps {
  imageSrc?: string;
  /** 叠在最上层的压暗遮罩，保证卡片文字可读性，与旧背景观感一致 */
  overlay?: string;
  grid?: number;
  mouse?: number;
  strength?: number;
  relaxation?: number;
  className?: string;
}

function supportsInteractiveEffect(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return false;
    }
    // 仅在能悬停的精确指针设备（鼠标）上启用；触屏不启用
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      return false;
    }
    if (window.innerWidth < 768) {
      return false;
    }
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    return !!gl;
  } catch {
    return false;
  }
}

export default function AuthGridBackground({
  imageSrc = "/login_bg2.png",
  overlay = "rgba(0, 0, 0, 0.20)",
  grid,
  mouse,
  strength,
  relaxation,
  className = "",
}: AuthGridBackgroundProps) {
  // 用 useSyncExternalStore 读取浏览器能力：服务端快照为 false 保证 hydration
  // 一致，客户端挂载后按真实环境决定是否启用特效（避免在 effect 中同步 setState）。
  const subscribe = useCallback(() => () => {}, []);
  const isInteractive = useSyncExternalStore(
    subscribe,
    () => supportsInteractiveEffect(),
    () => false,
  );
  // 仅当 WebGL 初始化/贴图运行时失败后置为失败，回退到静态图
  const [failed, setFailed] = useState(false);
  const active = isInteractive && !failed;

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      {/* 静态底图 / 兜底：始终渲染 */}
      <img
        src={imageSrc}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />

      {/* 交互式扭曲层：仅在受支持的桌面环境懒加载 */}
      {active && (
        <div className="absolute inset-0">
          <GridDistortion
            imageSrc={imageSrc}
            grid={grid}
            mouse={mouse}
            strength={strength}
            relaxation={relaxation}
            onError={() => setFailed(true)}
          />
        </div>
      )}

      {/* 压暗遮罩：与旧的黑色 0.20 overlay 观感一致，保证表单可读性 */}
      <div className="absolute inset-0" style={{ backgroundColor: overlay }} />
    </div>
  );
}
