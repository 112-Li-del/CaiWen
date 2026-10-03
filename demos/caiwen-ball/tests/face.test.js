import test from 'node:test';
import assert from 'node:assert/strict';
import { projectEye, clampToHull } from '../src/face.js';
import { radialHull, bodyCircles, radiusAt } from '../src/shape.js';
import { TAU } from '../src/math.js';

const base = { R: 66, cx: 100, cy: 105 };

test('正对用户时不偏不移，压缩系数为 1', () => {
  const p = projectEye({ ...base, yaw: 0, pitch: 0 });
  assert.ok(Math.abs(p.x - base.cx) < 1e-9);
  assert.ok(Math.abs(p.y - base.cy) < 1e-9);
  assert.ok(Math.abs(p.sx - 1) < 1e-9);
  assert.ok(p.visible);
});

test('绕到背面自动不可见', () => {
  assert.ok(!projectEye({ ...base, yaw: Math.PI }).visible);
  assert.ok(!projectEye({ ...base, yaw: 1.6 }).visible);
  assert.ok(projectEye({ ...base, yaw: 1.2 }).visible, '侧面仍应可见');
});

test('靠近边缘时水平被压缩', () => {
  const front = projectEye({ ...base, yaw: 0 });
  const side = projectEye({ ...base, yaw: 1.0 });
  assert.ok(side.sx < front.sx, '侧面的水平压缩应更强');
  assert.ok(side.sx > 0.1, '压缩不能塌成负数或 0');
});

test('左右对称：yaw 取反后 x 关于中心镜像', () => {
  const l = projectEye({ ...base, yaw: -0.3 });
  const r = projectEye({ ...base, yaw: 0.3 });
  assert.ok(Math.abs((l.x - base.cx) + (r.x - base.cx)) < 1e-9);
  assert.ok(Math.abs(l.y - r.y) < 1e-9);
});

test('方向约定锁定：yaw 正 = 向右，pitch 正 = 向上', () => {
  /* 这两条是 engine.js 视线映射的符号依据，改投影方向必须先改这里 */
  assert.ok(projectEye({ ...base, yaw: 0.3 }).x > base.cx, 'yaw 为正应在中心右侧');
  assert.ok(projectEye({ ...base, pitch: 0.3 }).y < base.cy, 'pitch 为正应在中心上方');
});

test('向上看眼睛上移，向下看下移', () => {
  const up = projectEye({ ...base, pitch: 0.3 });
  const down = projectEye({ ...base, pitch: -0.3 });
  assert.ok(up.y < base.cy, 'pitch 为正应向上（y 更小）');
  assert.ok(down.y > base.cy);
});

test('俯仰过大时眼睛不会跑出球体正投影范围', () => {
  for (let pitch = -1.2; pitch <= 1.2; pitch += 0.1) {
    const p = projectEye({ ...base, pitch, yaw: 0.9 });
    const dist = Math.hypot(p.x - base.cx, p.y - base.cy);
    assert.ok(dist <= base.R + 1e-6, `pitch=${pitch} 时距中心 ${dist} 超过半径`);
  }
});

test('clampToHull 把越界的点拉回轮廓内', () => {
  const hull = radialHull(bodyCircles(78), 48).map(([x, y]) => [x + 100, y + 105]);
  const far = { x: 100 + 300, y: 105 };
  const fixed = clampToHull(hull, 100, 105, far.x, far.y, 0.86);
  const dist = Math.hypot(fixed.x - 100, fixed.y - 105);
  const max = radiusAt(hull, 0, 100, 105) * 0.86;
  assert.ok(dist <= max + 1e-6, `拉回后仍越界：${dist} > ${max}`);
});

test('clampToHull 不改动已经在轮廓内的点', () => {
  const hull = radialHull(bodyCircles(78), 48);
  const p = { x: base.cx + 5, y: base.cy + 5 };
  const fixed = clampToHull(hull, base.cx, base.cy, p.x, p.y, 0.86);
  assert.equal(fixed.x, p.x);
  assert.equal(fixed.y, p.y);
});

test('回归：平移后的轮廓同样能正确约束眼睛', () => {
  const hull = radialHull(bodyCircles(78), 48).map(([x, y]) => [x + 100, y + 105]);
  const far = { x: 100 + 90, y: 105 };
  const fixed = clampToHull(hull, 100, 105, far.x, far.y, 0.86);
  const dist = Math.hypot(fixed.x - 100, fixed.y - 105);
  assert.ok(dist < 80, `应被拉回 80 以内，实际 ${dist.toFixed(1)}`);
  assert.ok(dist > 60, '且不应被拉得太狠');
});
