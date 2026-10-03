/* ============================================================
 * face.js —— 眼睛在球面上的定位与贴合规制
 * ------------------------------------------------------------
 * 借鉴来源：jeremy-prt/bloub（MIT）把眼睛放在球面坐标（yaw/pitch）
 * 上、按曲面朝向做切向压缩的做法。
 * 实现为本仓库独立编写：这里用正交投影，能自然得到三件事——
 *   1. 眼睛绕到球背面自动不可见
 *   2. 靠近边缘时水平方向自动被压缩（透视 foreshortening）
 *   3. 眼睛永远贴合球面，不会"浮"在身体外
 * ============================================================ */

import { clamp } from './math.js';
import { radiusAt } from './shape.js';

/**
 * 把球面上的一点投影到屏幕。
 * @param {object} p
 * @param {number} p.yaw   绕垂直轴经度（弧度），0 = 正对用户
 * @param {number} p.pitch 俯仰（弧度），正 = 向上看
 * @param {number} p.R     球面半径（眼睛贴合的有效半径）
 * @returns {{x:number,y:number,sx:number,sy:number,visible:boolean}}
 */
export function projectEye({ yaw = 0, pitch = 0, R = 68, cx = 100, cy = 105 }) {
  const cp = Math.cos(pitch);
  const depth = Math.cos(yaw) * cp;        /* 朝向观察者的深度分量 */
  return {
    x: cx + R * Math.sin(yaw) * cp,
    y: cy - R * Math.sin(pitch),
    sx: clamp(Math.abs(depth), 0.12, 1),   /* 水平方向的透视压缩 */
    sy: clamp(1 - Math.abs(Math.sin(pitch)) * 0.25, 0.6, 1),
    visible: depth > 0.12
  };
}

/**
 * 眼睛不得越过身形轮廓：超出的按比例拉回来。
 * 用于极端的挤压/歪头姿态下保证眼睛还在身体里。
 */
export function clampToHull(hull, cx, cy, x, y, ratio = 0.88) {
  const dx = x - cx;
  const dy = y - cy;
  const r = Math.hypot(dx, dy);
  if (r < 1e-6) return { x, y };
  const max = radiusAt(hull, Math.atan2(dy, dx), cx, cy) * ratio;
  if (r <= max) return { x, y };
  const k = max / r;
  return { x: cx + dx * k, y: cy + dy * k };
}
