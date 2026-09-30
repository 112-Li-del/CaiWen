"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * GridDistortion — ReactBits (Backgrounds)
 * https://www.reactbits.dev/backgrounds/grid-distortion
 *
 * 官方 TS/Tailwind 单文件组件，针对财问“全屏登录/注册背景”做了三处生产加固：
 *  1. cover 适配：默认按 background-size: cover 的方式裁切采样，避免图片被
 *     非等比拉伸（可用 cover={false} 关闭，回到官方默认的拉伸行为）。
 *  2. 失败兜底：WebGL 不可用 / 渲染器创建失败 / 贴图加载失败 / 上下文丢失时
 *     触发 onError，由外层卸载本组件并露出静态底图。
 *  3. 全局指针：鼠标事件监听在 window 上（坐标仍换算到容器），这样背景层可以
 *     保持 pointer-events-none，绝不会遮挡登录表单的点击。
 */

interface GridDistortionProps {
  /** 扭曲网格每边的格子数 */
  grid?: number;
  /** 跟随光标的扭曲半径（相对网格的比例） */
  mouse?: number;
  /** 扭曲强度 */
  strength?: number;
  /** 每帧扭曲场向初始状态回弹的系数（越小回弹越快） */
  relaxation?: number;
  /** 要渲染的图片地址 */
  imageSrc: string;
  /** 是否按 cover 方式裁切图片，默认 true */
  cover?: boolean;
  /** WebGL 初始化或贴图失败时回调，外层据此回退到静态图 */
  onError?: () => void;
  className?: string;
}

const vertexShader = /* glsl */ `
uniform float time;
varying vec2 vUv;
varying vec3 vPosition;
void main() {
  vUv = uv;
  vPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uDataTexture;
uniform sampler2D uTexture;
uniform vec4 uUvBounds; // xy = 裁切下界, zw = 裁切上界（cover 用）
varying vec2 vUv;
void main() {
  // 把铺满平面的 vUv 映射到图片“cover 裁切后”的区域，保持图片宽高比
  vec2 uv = mix(uUvBounds.xy, uUvBounds.zw, vUv);
  vec4 offset = texture2D(uDataTexture, vUv);
  gl_FragColor = texture2D(uTexture, uv - 0.02 * offset.rg);
}
`;

function isWebGLAvailable(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl2") ||
        canvas.getContext("webgl") ||
        canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

/** 计算 cover 模式下需要采样的图片 UV 区域（中心裁切）。 */
function computeCoverBounds(
  imageAspect: number,
  containerAspect: number,
): THREE.Vector4 {
  if (imageAspect > containerAspect) {
    // 图片更宽：高度填满，左右裁切
    const visibleWidth = containerAspect / imageAspect;
    const uMin = (1 - visibleWidth) / 2;
    return new THREE.Vector4(uMin, 0, uMin + visibleWidth, 1);
  }
  // 图片更高/更窄：宽度填满，上下裁切
  const visibleHeight = imageAspect / containerAspect;
  const vMin = (1 - visibleHeight) / 2;
  return new THREE.Vector4(0, vMin, 1, vMin + visibleHeight);
}

const GridDistortion: React.FC<GridDistortionProps> = ({
  grid = 15,
  mouse = 0.1,
  strength = 0.15,
  relaxation = 0.9,
  imageSrc,
  cover = true,
  onError,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const planeRef = useRef<THREE.Mesh | null>(null);
  const imageAspectRef = useRef<number>(1);
  const animationIdRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  // 用 ref 持有回调，避免回调身份变化导致整个 three 场景重建
  const onErrorRef = useRef<typeof onError>(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!containerRef.current) return;

    if (!isWebGLAvailable()) {
      onErrorRef.current?.();
      return;
    }

    const container = containerRef.current;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      onErrorRef.current?.();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    rendererRef.current = renderer;

    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const camera = new THREE.OrthographicCamera(0, 0, 0, 0, -1000, 1000);
    camera.position.z = 2;
    cameraRef.current = camera;

    const uniforms = {
      time: { value: 0 },
      resolution: { value: new THREE.Vector4() },
      uUvBounds: { value: new THREE.Vector4(0, 0, 1, 1) },
      uTexture: { value: null as THREE.Texture | null },
      uDataTexture: { value: null as THREE.DataTexture | null },
    };

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
      imageSrc,
      (texture) => {
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        imageAspectRef.current = texture.image.width / texture.image.height;
        uniforms.uTexture.value = texture;
        handleResize();
      },
      undefined,
      () => {
        onErrorRef.current?.();
      },
    );

    const size = grid;
    const data = new Float32Array(4 * size * size);
    for (let i = 0; i < size * size; i++) {
      data[i * 4] = Math.random() * 255 - 125;
      data[i * 4 + 1] = Math.random() * 255 - 125;
    }
    const dataTexture = new THREE.DataTexture(
      data,
      size,
      size,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    dataTexture.needsUpdate = true;
    uniforms.uDataTexture.value = dataTexture;

    const material = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
    });
    const geometry = new THREE.PlaneGeometry(1, 1, size - 1, size - 1);
    const plane = new THREE.Mesh(geometry, material);
    planeRef.current = plane;
    scene.add(plane);

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const rect = container.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      if (width === 0 || height === 0) return;
      const containerAspect = width / height;
      renderer.setSize(width, height);
      if (plane) {
        plane.scale.set(containerAspect, 1, 1);
      }
      const frustumHeight = 1;
      const frustumWidth = frustumHeight * containerAspect;
      camera.left = -frustumWidth / 2;
      camera.right = frustumWidth / 2;
      camera.top = frustumHeight / 2;
      camera.bottom = -frustumHeight / 2;
      camera.updateProjectionMatrix();
      uniforms.resolution.value.set(width, height, 1, 1);

      if (cover) {
        uniforms.uUvBounds.value.copy(
          computeCoverBounds(imageAspectRef.current, containerAspect),
        );
      } else {
        uniforms.uUvBounds.value.set(0, 0, 1, 1);
      }
    };

    if (window.ResizeObserver) {
      const resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(container);
      resizeObserverRef.current = resizeObserver;
    } else {
      window.addEventListener("resize", handleResize);
    }

    const mouseState = {
      x: 0,
      y: 0,
      prevX: 0,
      prevY: 0,
      vX: 0,
      vY: 0,
    };

    const resetMouse = () => {
      Object.assign(mouseState, {
        x: 0,
        y: 0,
        prevX: 0,
        prevY: 0,
        vX: 0,
        vY: 0,
      });
    };

    // 监听在 window 上：即使背景层 pointer-events-none、或光标位于表单卡片上方，
    // 依然能追踪鼠标；移出容器范围时视为离开。
    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!inside) {
        resetMouse();
        return;
      }
      const x = (e.clientX - rect.left) / rect.width;
      const y = 1 - (e.clientY - rect.top) / rect.height;
      mouseState.vX = x - mouseState.prevX;
      mouseState.vY = y - mouseState.prevY;
      Object.assign(mouseState, { x, y, prevX: x, prevY: y });
    };
    window.addEventListener("mousemove", handleMouseMove, { passive: true });

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      onErrorRef.current?.();
    };
    renderer.domElement.addEventListener(
      "webglcontextlost",
      handleContextLost,
    );

    handleResize();

    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);
      if (!renderer || !scene || !camera) return;
      uniforms.time.value += 0.05;
      if (!(dataTexture.image.data instanceof Float32Array)) {
        console.error("dataTexture.image.data is not a Float32Array");
        return;
      }
      const gridData: Float32Array = dataTexture.image.data;
      for (let i = 0; i < size * size; i++) {
        gridData[i * 4] *= relaxation;
        gridData[i * 4 + 1] *= relaxation;
      }
      const gridMouseX = size * mouseState.x;
      const gridMouseY = size * mouseState.y;
      const maxDist = size * mouse;
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          const distSq =
            Math.pow(gridMouseX - i, 2) + Math.pow(gridMouseY - j, 2);
          if (distSq < maxDist * maxDist) {
            const index = 4 * (i + size * j);
            const power = Math.min(maxDist / Math.sqrt(distSq), 10);
            gridData[index] += strength * 100 * mouseState.vX * power;
            gridData[index + 1] -= strength * 100 * mouseState.vY * power;
          }
        }
      }
      dataTexture.needsUpdate = true;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      } else {
        window.removeEventListener("resize", handleResize);
      }
      window.removeEventListener("mousemove", handleMouseMove);
      renderer.domElement.removeEventListener(
        "webglcontextlost",
        handleContextLost,
      );
      renderer.dispose();
      renderer.forceContextLoss();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      geometry.dispose();
      material.dispose();
      dataTexture.dispose();
      if (uniforms.uTexture.value) uniforms.uTexture.value.dispose();
      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      planeRef.current = null;
    };
  }, [grid, mouse, strength, relaxation, imageSrc, cover]);

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden ${className}`}
      style={{ minWidth: "0", minHeight: "0" }}
    />
  );
};

export default GridDistortion;
