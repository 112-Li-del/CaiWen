"use client";

import { useEffect, useRef } from "react";

import {
  canvasBitmapMatchesTarget,
  DISPLACEMENT_DECODE_SCALE,
  DISPLACEMENT_ZERO_BYTE,
  packDisplacement,
  resolveCanvasBitmapSize,
} from "./glitchDisplacement";
import {
  consumeGlitchPointerVelocity,
  createGlitchPointerState,
  type GlitchPointerState,
  moveGlitchPointer,
  resetGlitchPointer,
} from "./glitchPointer";

type GlitchPromptTitleProps = {
  title: string;
  subtitle: string;
};

const GRID_SIZE = 15;
const MOUSE_RADIUS = 0.25;
const STRENGTH = 0.15;
const RELAXATION = 0.9;

type WebGLProgramInfo = {
  program: WebGLProgram;
  positionBuffer: WebGLBuffer;
  titleTexture: WebGLTexture;
  dataTexture: WebGLTexture;
  data: Float32Array;
  packedData: Uint8Array;
  positionLocation: number;
  textureLocation: WebGLUniformLocation;
  dataTextureLocation: WebGLUniformLocation;
};

function createShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type);

  if (!shader) {
    throw new Error("Unable to create WebGL shader.");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "Unknown shader error.";
    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
}

function createProgram(gl: WebGLRenderingContext) {
  const vertexShader = createShader(
    gl,
    gl.VERTEX_SHADER,
    `
      attribute vec2 aPosition;
      varying vec2 vUv;

      void main() {
        vUv = (aPosition + 1.0) * 0.5;
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `,
  );

  const fragmentShader = createShader(
    gl,
    gl.FRAGMENT_SHADER,
    `
      precision mediump float;

      uniform sampler2D uTexture;
      uniform sampler2D uDataTexture;
      varying vec2 vUv;

      void main() {
        vec2 encodedOffset = texture2D(uDataTexture, vUv).rg;
        vec2 offset = (
          encodedOffset - vec2(${DISPLACEMENT_ZERO_BYTE}.0 / 255.0)
        ) * ${DISPLACEMENT_DECODE_SCALE}.0;
        vec4 color = texture2D(uTexture, vUv - offset * 0.02);
        gl_FragColor = color;
      }
    `,
  );

  const program = gl.createProgram();

  if (!program) {
    throw new Error("Unable to create WebGL program.");
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "Unknown program error.";
    gl.deleteProgram(program);
    throw new Error(message);
  }

  return program;
}

function drawTextTexture(
  canvas: HTMLCanvasElement,
  title: string,
  subtitle: string,
  titleColor: string,
  subtitleColor: string,
) {
  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  const width = canvas.width;
  const height = canvas.height;
  const scale = Math.min(width / 680, height / 144);
  const titleSize = Math.max(30, Math.floor(42 * scale));
  const subtitleSize = Math.max(14, Math.floor(17 * scale));

  context.clearRect(0, 0, width, height);
  context.textAlign = "center";
  context.textBaseline = "middle";

  context.fillStyle = titleColor;
  context.font = `700 ${titleSize}px "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif`;
  context.fillText(title, width / 2, height * 0.4);

  context.fillStyle = subtitleColor;
  context.font = `500 ${subtitleSize}px "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif`;
  context.fillText(subtitle, width / 2, height * 0.71);
}

function getCssVariable(element: Element, name: string) {
  return getComputedStyle(element).getPropertyValue(name).trim();
}

function createProgramInfo(gl: WebGLRenderingContext): WebGLProgramInfo {
  const program = createProgram(gl);
  const positionBuffer = gl.createBuffer();
  const titleTexture = gl.createTexture();
  const dataTexture = gl.createTexture();

  if (!positionBuffer || !titleTexture || !dataTexture) {
    throw new Error("Unable to create WebGL buffers.");
  }

  const data = new Float32Array(GRID_SIZE * GRID_SIZE * 2);
  const packedData = new Uint8Array(GRID_SIZE * GRID_SIZE * 4);

  for (let index = 0; index < GRID_SIZE * GRID_SIZE; index += 1) {
    packedData[index * 4] = DISPLACEMENT_ZERO_BYTE;
    packedData[index * 4 + 1] = DISPLACEMENT_ZERO_BYTE;
    packedData[index * 4 + 2] = 0;
    packedData[index * 4 + 3] = 255;
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );

  gl.bindTexture(gl.TEXTURE_2D, titleTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindTexture(gl.TEXTURE_2D, dataTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    GRID_SIZE,
    GRID_SIZE,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    packedData,
  );

  const positionLocation = gl.getAttribLocation(program, "aPosition");
  const textureLocation = gl.getUniformLocation(program, "uTexture");
  const dataTextureLocation = gl.getUniformLocation(program, "uDataTexture");

  if (!textureLocation || !dataTextureLocation) {
    throw new Error("Unable to locate WebGL uniforms.");
  }

  return {
    program,
    positionBuffer,
    titleTexture,
    dataTexture,
    data,
    packedData,
    positionLocation,
    textureLocation,
    dataTextureLocation,
  };
}

function updateDisplacement(
  info: WebGLProgramInfo,
  mouse: GlitchPointerState,
) {
  for (let index = 0; index < GRID_SIZE * GRID_SIZE; index += 1) {
    const dataIndex = index * 2;

    info.data[dataIndex] *= RELAXATION;
    info.data[dataIndex + 1] *= RELAXATION;

    if (mouse.active) {
      const cellX = index % GRID_SIZE;
      const cellY = Math.floor(index / GRID_SIZE);
      const pointerX = GRID_SIZE * mouse.x;
      const pointerY = GRID_SIZE * mouse.y;
      const radius = GRID_SIZE * MOUSE_RADIUS;
      const distanceX = pointerX - cellX;
      const distanceY = pointerY - cellY;
      const distance = distanceX * distanceX + distanceY * distanceY;

      if (distance < radius * radius) {
        const power = Math.min(radius / Math.sqrt(Math.max(distance, 0.0001)), 10);

        info.data[dataIndex] += 100 * STRENGTH * mouse.vX * power;
        info.data[dataIndex + 1] -= 100 * STRENGTH * mouse.vY * power;
      }
    }

    const packedIndex = index * 4;
    info.packedData[packedIndex] = packDisplacement(info.data[dataIndex]);
    info.packedData[packedIndex + 1] = packDisplacement(
      info.data[dataIndex + 1],
    );
  }
}

export default function GlitchPromptTitle({
  title,
  subtitle,
}: GlitchPromptTitleProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mouseRef = useRef<GlitchPointerState>(createGlitchPointerState());

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });

    if (!gl) {
      return;
    }

    const textCanvas = document.createElement("canvas");
    textCanvasRef.current = textCanvas;

    let frameId = 0;
    let disposed = false;
    const info = createProgramInfo(gl);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const size = resolveCanvasBitmapSize(
        rect.width,
        rect.height,
        window.devicePixelRatio || 1,
      );

      if (!size) {
        return false;
      }

      const { width, height } = size;

      if (!canvasBitmapMatchesTarget(canvas.width, canvas.height, size)) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }

      if (
        !canvasBitmapMatchesTarget(
          textCanvas.width,
          textCanvas.height,
          size,
        )
      ) {
        textCanvas.width = width;
        textCanvas.height = height;
      }

      return true;
    };

    const refreshTextTexture = () => {
      const root = document.documentElement;
      const titleColor = getCssVariable(root, "--foreground") || "#1f1d1b";
      const subtitleColor = getCssVariable(root, "--muted-foreground") || titleColor;

      if (!resize()) {
        return;
      }

      gl.bindTexture(gl.TEXTURE_2D, info.titleTexture);
      drawTextTexture(textCanvas, title, subtitle, titleColor, subtitleColor);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        textCanvas,
      );
    };

    const render = () => {
      if (disposed) {
        return;
      }

      updateDisplacement(info, mouseRef.current);
      consumeGlitchPointerVelocity(mouseRef.current);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(info.program);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, info.titleTexture);
      gl.uniform1i(info.textureLocation, 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, info.dataTexture);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        GRID_SIZE,
        GRID_SIZE,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        info.packedData,
      );
      gl.uniform1i(info.dataTextureLocation, 1);

      gl.bindBuffer(gl.ARRAY_BUFFER, info.positionBuffer);
      gl.enableVertexAttribArray(info.positionLocation);
      gl.vertexAttribPointer(info.positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      frameId = window.requestAnimationFrame(render);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = 1 - (event.clientY - rect.top) / rect.height;
      moveGlitchPointer(mouseRef.current, x, y);
    };

    const handlePointerLeave = () => {
      resetGlitchPointer(mouseRef.current);
    };

    const resizeObserver = new ResizeObserver(refreshTextTexture);
    const themeObserver = new MutationObserver(refreshTextTexture);

    resizeObserver.observe(canvas);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    window.addEventListener("resize", refreshTextTexture);

    refreshTextTexture();
    render();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("resize", refreshTextTexture);
      gl.deleteBuffer(info.positionBuffer);
      gl.deleteTexture(info.titleTexture);
      gl.deleteTexture(info.dataTexture);
      gl.deleteProgram(info.program);
    };
  }, [title, subtitle]);

  return (
    <div className="relative h-[132px] w-[min(680px,88vw)] sm:h-[144px]">
      <div className="sr-only">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="block h-full w-full cursor-default"
      />
    </div>
  );
}
