/* ============================================================
 * 回答中（12）= bloub「轨道」动作（官方源码逐字移植版）
 * ------------------------------------------------------------
 * bloub 的 orbit（src/bot/states.ts + decor.ts，参数为作者对参考视频
 * 的实测值）由三件事构成：
 *   a. 轨道环各自 3~3.7 圈/秒绕倾斜轨道面旋转（画面主导运动）；官方球是
 *      素圆，球面本身不转，"转起来"靠环 + 眼睛滑行传达。我们的经纬线在
 *      orbit 期间也只保持平时的慢速漂移——4 条经线等距 45°，全速自转时
 *      图案每 45° 自重合，只会看到"脉动"而不是连贯自转。
 *   b. 眼睛绕球面滑行 ±65°、6.5 rad/s（gaze = sin(t*6.5)*65°）。
 *   c. 六条 3D 轨道环：半长轴 1.3~1.4R、渐变描边、z<0 的半段画在球身之下
 *      被遮挡（前/后两层）；0.8s 渐显、每环错峰进场。环坐标以球心为原点，
 *      两个环 group 必须 translate 到 (CX,CY)，否则环以画布左上角为中心。
 * 锁五件事：
 *   1. 契约：orbit 参数 = bloub 实测值；环的前/后两层 + 6 条渐变就位且同心。
 *   2. 进场：整组 0.8s 渐显（初帧淡、1s 后全显）。
 *   3. 环在动：d 随时间变化；每条环前/后两段都会出现（真 3D 深度）。
 *   4. 球面不接管全速自转（经线仅慢速漂移）+ 眼睛大幅滑行；rig 不 2D 旋转。
 *   5. 切走：环整组淡出；旧"流星彩带"不再为 12 重生。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { node, walk, installFakeDom } from './fakedom.js';

/** rig 组：bodyPath 的 parent.parent（path→clipped→rig） */
function rigOf(host) {
  const body = walk(host).find((n) => n.tag === 'path' && /^url\(#cw-grad-/.test(n.attrs.fill || ''));
  assert.ok(body, '应找到球身 path');
  return body.parent.parent;
}
function rotateOf(rig) {
  const m = /rotate\((-?[\d.]+)\)/.exec(rig.attrs.transform || '');
  return m ? parseFloat(m[1]) : 0;
}
/** 六条环的 12 条 path（前/后各 6）：stroke 指向 cw-ring 渐变 */
const ringPaths = (host) => walk(host).filter((n) => n.tag === 'path' && /^url\(#cw-ring-/.test(n.attrs.stroke || ''));
const ringGrads = (host) => walk(host).filter((n) => n.tag === 'linearGradient' && /^cw-ring-/.test(n.attrs.id || ''));
/** 旧"流星彩带"（点球/完成特效）：12 期间不应再出现 */
const ribbonSegs = (host) => walk(host).filter((n) => n.tag === 'path' && /^url\(#cw-rbn-/.test(n.attrs.stroke || ''));
/** 经线：竖椭圆（stroke .55 的米色，区别于纬线的 .20） */
const meridiansOf = (host) => walk(host).filter((n) => n.tag === 'ellipse' && /255,246,220,\.55/.test(n.attrs.stroke || ''));
/** 眼睛 g：rect(奶油色) → inner → eye.g，transform 是每帧的 translate+rotate+scale */
const eyeGs = (host) => {
  const rects = walk(host).filter((n) => n.tag === 'rect' && n.attrs.fill === '#FFF6DC');
  return rects.map((r) => r.parent.parent);
};
const eyeX = (g) => {
  const m = /translate\((-?[\d.]+) /.exec(g.attrs.transform || '');
  return m ? parseFloat(m[1]) : null;
};

test('契约：12 的 orbit 参数 = bloub 实测值；环的两层 + 渐变就位', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const { STATES } = await import('../src/states.js');
  const o = STATES['12'].orbit;
  assert.equal(o.gazeHz, 6.5, '眼睛滑行 6.5 rad/s');
  assert.equal(o.gazeAmp, 65, '眼睛滑行 ±65°');
  assert.equal(o.spin, undefined, '球面不再全速自转（旋转交给环与眼睛）');

  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('12');
  pump.step(16);
  assert.equal(ringGrads(host).length, 6, `应有 6 条环渐变，实际 ${ringGrads(host).length}`);
  assert.equal(ringPaths(host).length, 12, '6 条环 × 前/后两层 = 12 条 path');
  assert.ok(ringGrads(host).every((g) => g.children.length === 3), '渐变应有 3 个色相停靠点');
  /* 渐变沿长轴铺：userSpaceOnUse */
  assert.ok(ringGrads(host).every((g) => g.attrs.gradientUnits === 'userSpaceOnUse'), '渐变应是 userSpaceOnUse');
  /* 同心：arcRender 坐标以球心为原点，两个环 group 必须平移到 (CX,CY)=(100,105)。
   * 漏掉这层 transform，环会以画布左上角为中心（即线上的"错位"）。 */
  const groups = [...new Set(ringPaths(host).map((p) => p.parent))];
  assert.equal(groups.length, 2, '环应分前/后两个 group');
  assert.ok(groups.every((g) => /^translate\(100 105\)$/.test(g.attrs.transform || '')),
    `两个环 group 都应 translate(100 105)，实际：${groups.map((g) => g.attrs.transform).join(' / ')}`);
  ball.destroy();
});

test('进场：整组 0.8s 渐显，初帧淡、1s 后全显', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('12');

  pump.step(16);
  const paths = ringPaths(host);
  const groups = paths.map((p) => p.parent);
  const groupOpacity = () => parseFloat(groups[0].attrs.opacity);
  assert.ok(groupOpacity() < 0.3, `初帧应还很淡：${groupOpacity()}`);
  for (let i = 0; i < 70; i++) pump.step(16);   /* ≈1.1s > 0.8s */
  assert.ok(Math.abs(groupOpacity() - 1) < 0.02, `1s 后应全显：${groupOpacity()}`);
  ball.destroy();
});

test('环在动：d 随时间变化；每条环前/后两段都会出现（真 3D 深度）', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('12');

  pump.step(16);
  const paths = ringPaths(host);
  const front = paths.filter((p) => p.parent !== paths[0].parent);
  const d0 = front[0].attrs.d;
  for (let i = 0; i < 12; i++) pump.step(16);   /* ≈0.2s */
  assert.notEqual(front[0].attrs.d, d0, '0.2s 后弧段 d 应已变化（环在转）');

  /* 环的转速 3~3.7 圈/秒、sweep 0.6~0.85，1.5s 内必有好几次穿过 z=0 的时刻；
   * 逐帧扫，直到看到"前段和后段同时非空"——z<0 的半段确实进了球后层 */
  const backG = paths[0].parent;
  let bothSeen = false;
  for (let i = 0; i < 95; i++) {
    pump.step(16);
    const ps = ringPaths(host);
    const bk = ps.filter((p) => p.parent === backG);
    const ft = ps.filter((p) => p.parent !== backG);
    if (ft.some((p) => p.attrs.d) && bk.some((p) => p.attrs.d)) { bothSeen = true; break; }
  }
  assert.ok(bothSeen, '1.5s 内应出现"环一半在球前、一半在球后"的帧');
  ball.destroy();
});

test('球面不接管全速自转：经线仅慢速漂移，眼睛仍大幅滑行；rig 不带 2D 旋转', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('12');

  const rig = rigOf(host);
  const mer = meridiansOf(host);
  const eyes = eyeGs(host);
  pump.step(16);
  const xs = [];
  let rxMin = Infinity, rxMax = -Infinity;
  for (let i = 0; i < 62; i++) {                /* ≈1s */
    pump.step(16);
    const rx = parseFloat(mer[0].attrs.rx);
    rxMin = Math.min(rxMin, rx); rxMax = Math.max(rxMax, rx);
    xs.push(eyeX(eyes[0]));
  }
  /* 球面不接管全速自转：慢速漂移 1s 相位只走 ~0.66 rad，rx 摆幅有上界
   * （|cos| 在 0.66 rad 窗口内最大变化 ≈0.61，满幅 R*1.2=93.6 → ≤~58）。
   * 旧版 1.25 圈/秒 1s 走 7.85 rad，摆幅接近满幅 93.6。 */
  const rxSpan = rxMax - rxMin;
  assert.ok(rxSpan < 70, `经线不应全速自转：rx 摆幅 ${rxSpan.toFixed(1)}px（应 < 70）`);
  /* 眼睛绕球面滑行：±65° yaw 在 EYE_R=66 的球面上 ≈ ±60px 的横移 */
  const span = Math.max(...xs) - Math.min(...xs);
  assert.ok(span > 30, `眼睛应大幅滑行：x 跨度 ${span.toFixed(1)}px`);
  /* rig 不带 2D 自转：12 没有 confetti，rotate 应恒为 0 */
  assert.equal(rotateOf(rig), 0, `rig 不应 2D 旋转，实测 ${rotateOf(rig)}`);
  ball.destroy();
});

test('切走：环整组淡出；旧"流星彩带"不再为 12 重生', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('12');
  for (let i = 0; i < 94; i++) pump.step(16);   /* ≈1.5s，环已全显 */
  assert.equal(ringPaths(host).length, 12, '12 期间环应在线');
  assert.equal(ribbonSegs(host).length, 0, '12 不应再触发旧流星彩带');

  ball.setEmotion('20');
  for (let i = 0; i < 60; i++) pump.step(16);   /* ≈1s，淡出应已走完 */
  const paths = ringPaths(host);
  const gOp = paths.length ? parseFloat(paths[0].parent.attrs.opacity) : 0;
  assert.ok(gOp < 0.05, `切走后环应淡出：opacity ${gOp}`);
  ball.destroy();
});
