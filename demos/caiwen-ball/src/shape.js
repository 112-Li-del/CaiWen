/* ============================================================
 * shape.js —— 身形轮廓：圆形包络 → 平滑路径
 * ------------------------------------------------------------
 * 借鉴来源：jeremy-prt/bloub（MIT）用「一组圆的并集」生成角色身形
 * （他那里叫 hullOfCircles / silhouette）。这样做的好处是身形由
 * 若干可独立动画的圆决定，挤压、拉伸、歪头都是改参数，不用重画路径。
 *
 * 实现为本仓库独立编写：这里用「角度射线取最大交点」的极坐标包络，
 * 比通用凸包更适合星形/非凸的中心化身形，且能顺带给出 clampToHull
 * 需要的 radiusAt()。
 * ============================================================ */

import { TAU, lerp, smoothClosedPath } from './math.js';

/* ============================================================
 * 待机形变目标形状（用户参考 bloub 风格的形态轮播）
 * 契约：所有形状都是「以原点为中心的星形轮廓」，用极坐标半径表
 * 表示，与 sphereSilhouette 同一套取样约定（θ 从 0 起、均匀 samples）。
 * 引擎做形变 = 同一角度上把球半径与目标半径插值，天然光滑无跳变。
 * ============================================================ */

export const MORPH_KINDS = ['ball', 'pancake', 'hexagon', 'triangle'];

/** 在高分辨率半径序列上做「角度窗口」的循环滑动平均（窗口按度数，与采样密度无关） */
function smoothRadiiByAngle(r, windowDeg) {
  const n = r.length;
  const half = Math.max(1, Math.round((windowDeg / 360) * n / 2));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -half; k <= half; k++) sum += r[(i + k + n) % n];
    out[i] = sum / (2 * half + 1);
  }
  return out;
}

/** 正 n 边形的极坐标半径（顶点在 θ = rot + k·2π/n 处） */
function polygonRadius(theta, n, rv, rot) {
  const side = TAU / n;
  let a = ((theta - rot) % side + side) % side;   /* 归到 [0, side) */
  a -= side / 2;                                   /* 以边中点为对称中心 */
  return (rv * Math.cos(side / 2)) / Math.cos(a);  /* apothem / cos(偏角) */
}

/**
 * 生成形变目标形状的半径表。
 * @param {'ball'|'pancake'|'hexagon'|'triangle'} kind
 * @returns {Float64Array} 长度 samples 的半径表（θ_i = i/samples·TAU 处的半径）
 *
 * 实现踩坑记录：
 * - 多边形圆角必须在 512 点高分辨率上按「角度窗口」平滑后降采样；
 *   直接在 64 点上做 9 点滑动平均会把六角磨成球（峰谷差只剩 2%），
 *   因为顶点只占一两个样本，全被邻居平均掉了。
 * - 形变项必须作用在「极坐标半径标量」上，作用在 x/y 分量上会在轴向
 *   极点处失效（该分量≈0）——taper 和 egg 先后栽在同一个坑里。
 */
export function shapeRadiusTable(kind, R, samples = 64) {
  const table = new Float64Array(samples);
  if (kind === 'ball' || !MORPH_KINDS.includes(kind)) {
    table.fill(R);
    return table;
  }
  if (kind === 'pancake') {
    /* 压扁圆柱饼（stadium / 横放胶囊）：宽 2a、高 2b，上下是平直边、左右半圆。
     * 极坐标半径分段：
     *   射线打到上下直边（|tanθ| ≥ b/c）：r = b / |sinθ|
     *   射线打到左右半圆：r = c·|cosθ| + √(b² − c²·sin²θ)，c = a − b
     * 之后按 6° 窗口轻磨直边与半圆的切点（那里曲率跳变）。
     * a=1.12R / b=0.60R：宽高比 1.87，压扁感明显但不超过画布太多。 */
    const a = R * 1.12, b = R * 0.60, c = a - b;
    const HI = 512;
    const raw = new Float64Array(HI);
    for (let i = 0; i < HI; i++) {
      const t = (i / HI) * TAU;
      const s = Math.abs(Math.sin(t));
      const co = Math.abs(Math.cos(t));
      raw[i] = (s === 0 || Math.abs(Math.tan(t)) < b / c)
        ? c * co + Math.sqrt(Math.max(0, b * b - c * c * s * s))
        : b / s;
    }
    const sm = smoothRadiiByAngle(raw, 6);
    for (let i = 0; i < samples; i++) table[i] = sm[Math.round((i * HI) / samples) % HI];
    return table;
  }
  /* 六角 / 三角：512 点生成正多边形极坐标半径 → 角度窗口平滑出圆角 →
   * 归一化（补偿削峰）→ 降采样。两者都是「竖着」的：rot=-90° 让顶点落在
   * 正上方 / 正下方，平边在左右两侧（pointy-top）。正六边形这么摆天然
   * 高 > 宽（顶点距 2rv vs 平边距 √3·rv），正是要的竖长感。
   * 窗口越小棱角越明显：16° 是"参考图"档，最初用 30° 被反馈"六角不明显"。 */
  const n = kind === 'hexagon' ? 6 : 3;
  const rot = -Math.PI / 2;
  const windowDeg = kind === 'hexagon' ? 16 : 34;
  const rv = R * 1.05;
  const HI = 512;
  const raw = new Float64Array(HI);
  for (let i = 0; i < HI; i++) raw[i] = polygonRadius((i / HI) * TAU, n, rv, rot);
  const sm = smoothRadiiByAngle(raw, windowDeg);
  let max = 0;
  for (const v of sm) if (v > max) max = v;
  const k = rv / max;
  for (let i = 0; i < samples; i++) table[i] = sm[Math.round((i * HI) / samples) % HI] * k;
  return table;
}

/** 按角度查半径表（邻接取样点线性插值） */
export function tableRadiusAt(table, theta) {
  const n = table.length;
  const a = ((theta % TAU) + TAU) % TAU;
  const f = (a / TAU) * n;
  const i0 = Math.floor(f) % n;
  const i1 = (i0 + 1) % n;
  return lerp(table[i0], table[i1], f - Math.floor(f));
}

/**
 * 求若干圆的并集轮廓。
 * 对每个角度方向发一条射线，取与所有圆交点中最远的那个。
 * @returns {Array<[number,number]>} 均匀取样（逆时针）的轮廓点表
 */
export function radialHull(circles, samples = 48) {
  const out = [];
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * TAU;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let best = 0;
    for (const c of circles) {
      const proj = c.cx * dx + c.cy * dy;              /* 圆心在射线上的投影 */
      const perp2 = c.cx * c.cx + c.cy * c.cy - proj * proj;  /* 圆心到射线的垂距平方 */
      const rr = c.r * c.r - perp2;
      if (rr <= 0) continue;                            /* 射线不与这个圆相交 */
      const t = proj + Math.sqrt(rr);
      if (t > best) best = t;
    }
    out.push([dx * best, dy * best]);
  }
  return out;
}

/** 任意角度处的轮廓半径（邻接取样点线性插值）。轮廓若已平移，传入球心坐标 */
export function radiusAt(hull, angle, cx = 0, cy = 0) {
  const n = hull.length;
  if (!n) return 0;
  const a = ((angle % TAU) + TAU) % TAU;
  const f = (a / TAU) * n;
  const i0 = Math.floor(f) % n;
  const i1 = (i0 + 1) % n;
  const t = f - Math.floor(f);
  const r0 = Math.hypot(hull[i0][0] - cx, hull[i0][1] - cy);
  const r1 = Math.hypot(hull[i1][0] - cx, hull[i1][1] - cy);
  return lerp(r0, r1, t);
}

/**
 * 由人可读的参数生成决定身形的一组圆。
 *   squash > 0 变矮胖，< 0 变瘦高
 *   taper  > 0 下宽上窄（水滴/水滴感的困倦），< 0 反之
 *   lean   > 0 整体向右倾
 *
 * ⚠ 这些圆以「原点为球心」。radialHull 的射线从原点出发，
 *   想把球画到别处请平移轮廓点，不要平移这些圆。
 */
export function bodyCircles(R, spec = {}) {
  const { squash = 0, taper = 0, lean = 0 } = spec;
  const N = 8;
  const d = R * 0.275;      /* 环半径 */
  const base = R * 0.75;    /* 环上圆的半径 */
  const offset = lean * R * 0.07;
  const circles = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const cx = Math.cos(a) * d * (1 + squash) + offset;
    const cy = Math.sin(a) * d * (1 - squash);
    const down = cy > 0 ? 1 : -1;
    circles.push({ cx, cy, r: base * (1 + taper * 0.13 * down) });
  }
  /* 中心兜底圆：taper 很大时不至于中间塌陷 */
  circles.push({ cx: offset, cy: 0, r: base * 0.97 });
  return circles;
}

/** 圆组 → SVG path（含二次平滑） */
export function circlesToPath(circles, samples = 48) {
  return smoothClosedPath(radialHull(circles, samples));
}

/**
 * 球形身形：以「低频调和形变」直接给半径函数，替代圆包络。
 *
 * 为什么不用 bodyCircles + radialHull：离散圆取并集会在圆与圆的交界处
 * 产生扇贝状波纹（肉眼看就是"坑坑洼洼"），且取样数固定后无法根除。
 * 这里 r(θ) 由连续函数给出——椭圆底形 + 一个正弦锥形项 + 呼吸乘数，
 * 全部是低频项，输出天然光滑，眼睛贴合用的 radiusAt 也照常工作。
 *
 *   squash > 0 变矮胖（宽 × 高 −），< 0 变瘦高
 *   taper  > 0 下宽上窄（水滴感的困倦），< 0 反之
 *   lean   > 0 整体逆时针歪头（弧度比例）
 *   breathe  呼吸乘数（引擎传入 1 + amp·sin，直接乘在半径上）
 *
 * @returns {Array<[number,number]>} 以原点为球心的均匀轮廓点表
 */
export function sphereSilhouette(R, spec = {}, samples = 64) {
  const { squash = 0, taper = 0, lean = 0, breathe = 1 } = spec;
  const ax = R * (1 + squash);          /* 水平半轴 */
  const ay = R * (1 - squash);          /* 垂直半轴 */
  const rot = lean * 0.35;              /* 歪头只旋转形变方向，不旋转取样 */
  const pts = [];
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * TAU;
    const a = t + rot;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    /* 参数化椭圆点；taper 按「下垂程度」缩放横向坐标——这才是几何意义上的
     * 下宽上窄（把锥形项乘在半径上只会把底部拉长，宽度纹丝不动，是个真 bug） */
    const px = ax * ca * (1 + taper * 0.12 * sa);
    const py = ay * sa;
    pts.push([px * breathe, py * breathe]);
  }
  return pts;
}
