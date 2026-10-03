import test from 'node:test';
import assert from 'node:assert/strict';
import { radialHull, bodyCircles, radiusAt, circlesToPath, sphereSilhouette,
  shapeRadiusTable, tableRadiusAt, MORPH_KINDS } from '../src/shape.js';
import { TAU } from '../src/math.js';

test('单个圆的包络就是自身：任意角度半径等于 r', () => {
  const hull = radialHull([{ cx: 0, cy: 0, r: 10 }], 32);
  for (const [x, y] of hull) {
    assert.ok(Math.abs(Math.hypot(x, y) - 10) < 1e-9);
  }
});

test('偏置圆：沿偏置方向的最大半径 = 距离 + r', () => {
  const hull = radialHull([{ cx: 20, cy: 0, r: 5 }], 64);
  let max = 0;
  for (const [x, y] of hull) max = Math.max(max, Math.hypot(x, y));
  assert.ok(Math.abs(max - 25) < 1e-6, `应为 25，实际 ${max}`);
});

test('多个圆的并集不小于其中任一圆的贡献', () => {
  const cs = [{ cx: 0, cy: 0, r: 20 }, { cx: 30, cy: 0, r: 20 }];
  const hull = radialHull(cs, 64);
  const max = Math.max(...hull.map(([x, y]) => Math.hypot(x, y)));
  assert.ok(Math.abs(max - 50) < 1e-6);
});

test('默认身形接近正圆（各方向半径差异 < 5%）', () => {
  const hull = radialHull(bodyCircles(78), 64);
  const rs = hull.map(([x, y]) => Math.hypot(x, y));
  const min = Math.min(...rs);
  const max = Math.max(...rs);
  assert.ok((max - min) / max < 0.05, `圆度不足：min=${min.toFixed(2)} max=${max.toFixed(2)}`);
  assert.ok(Math.abs(max - 80) < 2, `默认半径应约 80，实际 ${max.toFixed(2)}`);
});

test('squash 真的会改变宽高比', () => {
  const flat = radialHull(bodyCircles(78, { squash: 0.25 }), 64);
  const tall = radialHull(bodyCircles(78, { squash: -0.25 }), 64);
  const wideOf = (hull) => Math.max(...hull.map(([x, y]) => Math.abs(x)));
  const highOf = (hull) => Math.max(...hull.map(([x, y]) => Math.abs(y)));
  assert.ok(wideOf(flat) > wideOf(tall), '矮胖应更宽');
  assert.ok(highOf(tall) > highOf(flat), '瘦高应更高');
});

test('radiusAt 在取样点之间插值且连续', () => {
  const hull = radialHull([{ cx: 0, cy: 0, r: 30 }], 16);
  for (let i = 0; i < 32; i++) {
    assert.ok(Math.abs(radiusAt(hull, (i / 32) * TAU) - 30) < 1e-6);
  }
});

test('回归：轮廓平移后 radiusAt 必须以新球心为基准', () => {
  const hull = radialHull(bodyCircles(78), 48).map(([x, y]) => [x + 100, y + 105]);
  for (let i = 0; i < 16; i++) {
    const r = radiusAt(hull, (i / 16) * TAU, 100, 105);
    assert.ok(Math.abs(r - 80) < 3, `以 (100,105) 为心量半径应约 80，实际 ${r.toFixed(1)}`);
  }
});

test('circlesToPath 产出可用路径且闭合', () => {
  const d = circlesToPath(bodyCircles(78), 48);
  assert.ok(d.startsWith('M '));
  assert.ok(d.includes('C'));
  assert.ok(!d.includes('NaN'));
});

/* ---------- sphereSilhouette：球形身形（替代圆包络） ---------- */

test('无参数时是完美正圆：任意角度半径都等于 R', () => {
  const pts = sphereSilhouette(78, {}, 64);
  for (const [x, y] of pts) {
    assert.ok(Math.abs(Math.hypot(x, y) - 78) < 1e-9, `半径偏差：${Math.hypot(x, y)}`);
  }
});

test('squash 真的改变宽高比（宽 > 高 或反之）', () => {
  const flat = sphereSilhouette(78, { squash: 0.2 }, 64);
  const wideOf = Math.max(...flat.map(([x]) => Math.abs(x)));
  const highOf = Math.max(...flat.map(([, y]) => Math.abs(y)));
  assert.ok(wideOf > highOf, `squash>0 应更宽：宽${wideOf.toFixed(1)} 高${highOf.toFixed(1)}`);
});

test('轮廓光滑：相邻取样点半径差不超过 2.5%（坑坑洼洼回归测试）', () => {
  for (const spec of [{}, { squash: 0.08, taper: 0.22 }, { squash: -0.05, taper: -0.1, lean: 0.25 }]) {
    const pts = sphereSilhouette(78, spec, 64);
    let prev = Math.hypot(pts[0][0], pts[0][1]);
    for (let i = 1; i <= pts.length; i++) {
      const [x, y] = pts[i % pts.length];
      const r = Math.hypot(x, y);
      assert.ok(Math.abs(r - prev) < r * 0.025, `spec=${JSON.stringify(spec)} 在取样点 ${i} 处有折角`);
      prev = r;
    }
  }
});

test('taper 只让下半部更宽，上半部基本不变', () => {
  const base = sphereSilhouette(78, {}, 64);
  const pear = sphereSilhouette(78, { taper: 0.25 }, 64);
  /* 避开赤道线：sin(π) 在浮点里是 1.2e-16 > 0，会把最宽点算进错误的半区 */
  const w = (pts) => Math.max(...pts.filter(([, y]) => y > 12).map(([x]) => Math.abs(x)));
  const up = (pts) => Math.max(...pts.filter(([, y]) => y < -12).map(([x]) => Math.abs(x)));
  assert.ok(w(pear) > w(base), `下半部应更宽：pear ${w(pear).toFixed(2)} vs base ${w(base).toFixed(2)}`);
  assert.ok(up(pear) < w(pear), '上半部应窄于下半部');
});

/* ---------------- 形变目标形状（待机轮播） ---------------- */

test('ball 表恒等于 R，未知 kind 也回落为球', () => {
  for (const kind of ['ball', '不存在']) {
    const t = shapeRadiusTable(kind, 78, 64);
    for (const v of t) assert.equal(v, 78);
  }
});

test('所有形变表均为正有限值', () => {
  for (const kind of ['pancake', 'hexagon', 'triangle']) {
    const t = shapeRadiusTable(kind, 78, 64);
    for (const v of t) assert.ok(Number.isFinite(v) && v > 0, `${kind} 出现非法半径 ${v}`);
  }
});

test('pancake（压扁圆柱饼）：明显宽扁，顶部平坦', () => {
  const t = shapeRadiusTable('pancake', 78, 64);
  const at = (deg) => tableRadiusAt(t, (deg / 360) * TAU);
  assert.ok(at(0) / at(90) > 1.7, `宽高比 ${(at(0) / at(90)).toFixed(2)} 应 > 1.7`);
  /* 圆柱饼的标志是「平顶」：顶部 ±12° 内半径几乎不变（stadium 直边）。
   * 椭圆在这个区间会明显下垂，所以这条能区分"饼"和"扁椭圆"。 */
  const flat = Math.abs(at(78) - at(90)) / at(90);
  assert.ok(flat < 0.04, `顶部平坦度 ${((flat) * 100).toFixed(1)}% 应 < 4%`);
});

test('六角是「竖着」的：顶点在正上/正下，平边在左右', () => {
  const t = shapeRadiusTable('hexagon', 78, 64);
  const at = (deg) => tableRadiusAt(t, (deg / 360) * TAU);
  assert.ok(at(270) > at(0), `顶部(${at(270).toFixed(1)}) 应为顶点、大于侧边(${at(0).toFixed(1)})`);
  assert.ok(at(90) > at(0), '底部也应落在顶点上（上下各一个尖）');
  /* 左右是平边：0° 附近 ±15° 半径几乎不变 */
  assert.ok(Math.abs(at(15) - at(0)) / at(0) < 0.05, '左右应为平边');
  /* 竖长：上下顶点距 > 左右平边距 */
  assert.ok(at(270) + at(90) > at(0) + at(180), '整体应为竖长而非横宽');
});

test('多边形顶点数正确：hexagon 6 个峰、triangle 3 个峰', () => {
  const peaks = (kind) => {
    const t = shapeRadiusTable(kind, 78, 256);
    let count = 0;
    for (let i = 0; i < 256; i++) {
      const prev = t[(i + 255) % 256], next = t[(i + 1) % 256];
      if (t[i] > prev && t[i] >= next) count++;
    }
    return count;
  };
  assert.equal(peaks('hexagon'), 6);
  assert.equal(peaks('triangle'), 3);
});

test('圆角生效：峰谷差显著小于尖角理论值，但仍保留多边形特征', () => {
  /* 无圆角理论峰谷差：hexagon 15.5%（1/cos30°−1）、triangle 100%（1/cos60°−1）。
   * 三角形重心偏顶点，顶点 82 / 对边中点 51 是正常几何（差 37%），不能一刀切 35%。 */
  const spread = (kind) => {
    const t = shapeRadiusTable(kind, 78, 128);
    return (Math.max(...t) - Math.min(...t)) / Math.max(...t);
  };
  const hex = spread('hexagon'), tri = spread('triangle');
  assert.ok(hex > 0.04 && hex < 0.14, `hexagon 峰谷差 ${(hex * 100).toFixed(1)}% 应在 4%~14%（太小平、太大尖）`);
  assert.ok(tri > 0.2 && tri < 0.48, `triangle 峰谷差 ${(tri * 100).toFixed(1)}% 应在 20%~48%`);
});

test('pancake 半径表按角度查询连续无突变', () => {
  const t = shapeRadiusTable('pancake', 78, 64);
  let prev = tableRadiusAt(t, 0);
  for (let i = 1; i <= 512; i++) {
    const r = tableRadiusAt(t, (i / 512) * TAU);
    assert.ok(Math.abs(r - prev) < r * 0.06, `pancake 表在 ${i}/512 处突变（直边/半圆切点没磨平？）`);
    prev = r;
  }
});

test('MORPH_KINDS 对外契约稳定', () => {
  assert.deepEqual(MORPH_KINDS, ['ball', 'pancake', 'hexagon', 'triangle']);
});
