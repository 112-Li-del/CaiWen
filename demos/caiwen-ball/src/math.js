/* ============================================================
 * math.js —— 通用数学与插值工具
 * ------------------------------------------------------------
 * 无 DOM 依赖，可被 Node 直接 import 做单元测试。
 *
 * 借鉴来源：jeremy-prt/bloub（MIT）——把缓动、插值、帧率无关逼近
 * 集中到一层便于测试的组织方式。
 * 实现为本仓库独立编写，未使用 bloub 的任何测量数据或状态参数。
 * ============================================================ */

export const TAU = Math.PI * 2;

export function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

export function lerp(a, b, t) { return a + (b - a) * t; }

export function rand(a, b) { return a + Math.random() * (b - a); }

/** 常用缓动。约定：输入 t ∈ [0,1]，输出从 0 平滑到 1 */
export const easings = {
  linear: (t) => t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  outBack: (t) => {
    const c = 1.70158;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  }
};

/**
 * 多周期叠加噪声：用一组**互不成整数比**的周期叠加，得到永不重复的缓慢摆动。
 * 单个正弦盯上 20 秒就能看出规律；三个互不整除的周期叠加，重复周期长到看不出来。
 * 思路来自 jeremy-prt/bloub 的待机生命感做法（那一套是通用噪声参数，非其测量数据）。
 * @param t 秒    @param periods 秒为单位的周期数组
 * @returns [-1,1]
 */
export function loopNoise(t, periods, phase = 0) {
  if (!periods || !periods.length) return 0;
  let s = 0;
  for (const p of periods) s += Math.sin((t / p) * TAU + phase);
  return s / periods.length;
}

/** 平滑阶跃：两端导数为 0，比线性更像"缓缓过渡"而非"匀速开关" */
export function smoothstep(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * 梯形脉冲：[start,end] 内为 1，两端各有 fade 长度的缓入缓出斜坡，窗外为 0。
 * 用来表达「一段时间里淡入某个状态、待一会儿、再淡出」——待机中间打盹就是这么做的。
 * @param t 秒   @param start/end 秒   @param fade 秒
 * @returns 0~1
 */
export function pulseAmount(t, start, end, fade = 0.35) {
  /* NaN 守卫：所有与 NaN 的比较都是 false，会一路落到末尾返回 1，
   * 一个 NaN 混进每帧循环就再也洗不掉（球会永远停在睡眠态）。直接拒绝。 */
  if (!Number.isFinite(t) || !Number.isFinite(start) || !Number.isFinite(end)) return 0;
  if (!(end > start)) return 0;
  /* fade 不得超过半窗，否则进出斜坡会撞在一起，永远到不了 1 */
  const f = Math.max(1e-6, Math.min(fade, (end - start) / 2));
  if (t <= start - f || t >= end + f) return 0;
  if (t < start) return smoothstep((t - (start - f)) / f);
  if (t > end) return 1 - smoothstep((t - end) / f);
  return 1;
}

/**
 * 加权随机抽一项（微表情用）。按 weight 累积区间命中，weight 缺省/非法按 1 算。
 * rnd 参数化是为了可测：测试注入确定性序列就能保证每种微表情都被抽到。
 * @param items [{ weight?, ... }]  @param rnd 返回 [0,1) 的函数
 */
export function pickWeighted(items, rnd = Math.random) {
  if (!items || !items.length) return null;
  let total = 0;
  for (const it of items) total += Number.isFinite(it && it.weight) && it.weight > 0 ? it.weight : 1;
  if (!(total > 0)) return null;
  let r = rnd();
  if (!Number.isFinite(r)) r = 0;
  r = Math.min(0.999999, Math.max(0, r)) * total;
  for (const it of items) {
    const w = Number.isFinite(it.weight) && it.weight > 0 ? it.weight : 1;
    if (r < w) return it;
    r -= w;
  }
  return items[items.length - 1];
}

/**
 * 眨眼开合曲线。count=1 单眨，count=2 连眨两下（一闭一开重复两次）。
 * t ∈ [0,1]，返回 0(全闭)~1(全睁)。 |cos| 保证两端都是睁着的，中间闭到底。
 */
export function blinkOpenMul(t, count = 1) {
  const n = Math.max(1, count | 0);
  const phase = t * n;
  return Math.abs(Math.cos((phase - Math.floor(phase)) * Math.PI));
}

/** 临界阻尼弹簧。set(...)=设目标值，step 返回当前值 */
export function spring(value) { return { x: value, v: 0, t: value }; }

export function springStep(s, omega, zeta, dt) {
  const sub = Math.max(1, Math.ceil(dt / (1 / 120)));  /* 子步长 1/120s，保证大 dt 下数值稳定 */
  const h = dt / sub;
  for (let i = 0; i < sub; i++) {
    s.v += (-2 * zeta * omega * s.v - omega * omega * (s.x - s.t)) * h;
    s.x += s.v * h;
  }
  if (!Number.isFinite(s.x) || !Number.isFinite(s.v)) { s.x = s.t; s.v = 0; }
  return s.x;
}

/**
 * 帧率无关的指数逼近。
 * 直接写 cur += (tgt-cur)*0.1 会让效果随帧率变化；这里用 exp(-rate*dt)，
 * 60fps 与 120fps 下表现一致。
 */
export function approach(cur, target, rate, dt) {
  return target + (cur - target) * Math.exp(-rate * dt);
}

/** Catmull-Rom 插值 → 闭合三次贝塞尔路径，用于把手绘点表变成平滑轮廓 */
export function smoothClosedPath(pts) {
  const n = pts.length;
  if (n < 3) return '';
  const f = (v) => v.toFixed(2);
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${f(c1x)} ${f(c1y)}, ${f(c2x)} ${f(c2y)}, ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + ' Z';
}
