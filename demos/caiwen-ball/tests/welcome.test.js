/* ============================================================
 * 02 欢迎：笑弧 + 拍球式入场弹跳
 * ------------------------------------------------------------
 * 锁四件事：
 *   1. 两只眼都切成 happy 笑弧（normal/wide 淡出，左右一致，不再大小眼）；
 *   2. 入场 hop 把球抬起来（Y 位移为负），跑满 times 跳后归零收住；
 *   3. 一跳比一跳矮：逐跳峰值严格递减，且大致符合 decay；
 *   4. 触地瞬间有非等比挤压（scale 的 x/y 不相等），弹起时接近等比。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { node, walk, installFakeDom } from './fakedom.js';

function rigOf(host) {
  const body = walk(host).find((n) => n.tag === 'path' && /^url\(#cw-grad-/.test(n.attrs.fill || ''));
  assert.ok(body, '应找到球身 path');
  return body.parent.parent;
}

/** 第一个 translate 的 Y 位移（shake/hop/bounce 都在这里） */
function dyOf(rig) {
  const m = /^translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(rig.attrs.transform || '');
  return m ? parseFloat(m[2]) : 0;
}

/** scale(sx sy)：非等比时 x/y 不等 */
function scaleOf(rig) {
  const m = /scale\((-?[\d.]+) (-?[\d.]+)\)/.exec(rig.attrs.transform || '');
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : [1, 1];
}

const happyNodes = (host) =>
  walk(host).filter((n) => n.tag === 'path' && (n.attrs.d || '') === 'M -10 5 Q 0 -9 10 5');

test('欢迎：两只眼都是笑弧，且左右一致', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  pump.step(16); pump.step(16);

  ball.setEmotion('02');
  for (let i = 0; i < 60; i++) pump.step(16);   /* 等眼形交叉淡入完成 */

  const arcs = happyNodes(host);
  assert.equal(arcs.length, 2, `应有左右两只笑弧，实际 ${arcs.length}`);
  for (const a of arcs) {
    assert.ok(parseFloat(a.attrs.opacity) > 0.9, `笑弧应完全淡入，实际 opacity=${a.attrs.opacity}`);
    /* w=26 → 等比放大到 1.3 倍（基准 20） */
    assert.match(a.attrs.transform || '', /^scale\(1\.300\)$/, '笑弧应按 w 等比缩放');
  }
  /* 两眼缩放一致 = 不再大小眼 */
  assert.equal(arcs[0].attrs.transform, arcs[1].attrs.transform);
  /* 矩形眼形让位给笑弧 */
  for (const r of walk(host).filter((n) => n.tag === 'rect' && n.attrs.fill === '#FFF6DC')) {
    assert.ok(parseFloat(r.attrs.opacity) < 0.1, '欢迎时 normal/wide 矩形眼应淡出');
  }

  ball.destroy();
});

test('欢迎：入场是拍球式连跳，一跳比一跳矮，弹完归位', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  pump.step(16); pump.step(16);

  const rig = rigOf(host);
  ball.setEmotion('02');

  /* 按 hop.period 采 4 跳的峰值：每跳取该区间内 |dy| 最大者 */
  const peaks = [];
  let sawSquash = false;
  const FRAMES_PER_HOP = 33;          /* 0.52s / 16ms ≈ 32.5 */
  for (let hop = 0; hop < 4; hop++) {
    let peak = 0;
    for (let i = 0; i < FRAMES_PER_HOP; i++) {
      pump.step(16);
      const dy = dyOf(rig);
      if (dy < peak) peak = dy;                 /* 向上为负 */
      const [sx, sy] = scaleOf(rig);
      if (Math.abs(sx - sy) > 0.02) sawSquash = true;
    }
    peaks.push(peak);
  }

  assert.ok(peaks[0] < -12, `第一跳应明显跳起来，实测 ${peaks[0].toFixed(1)}px`);
  for (let i = 1; i < peaks.length; i++) {
    assert.ok(peaks[i] > peaks[i - 1],
      `第 ${i + 1} 跳应比上一跳矮：${peaks.map((v) => v.toFixed(1)).join(' > ')}`);
  }
  /* 逐跳比例应接近 decay 0.55（留 0.25 容差，采样点未必正好落在顶点） */
  for (let i = 1; i < peaks.length; i++) {
    const ratio = peaks[i] / peaks[i - 1];
    assert.ok(ratio > 0.3 && ratio < 0.8, `第 ${i + 1} 跳/上一跳 = ${ratio.toFixed(2)}，应接近 decay 0.55`);
  }
  assert.ok(sawSquash, '触地瞬间应有非等比挤压（弹跳的重量感来源）');

  /* 弹完收住：再跑 1s，Y 位移回到持续 bounce 的小幅范围内（不再是几十 px 的跳） */
  for (let i = 0; i < 60; i++) pump.step(16);
  assert.ok(Math.abs(dyOf(rig)) < 6, `弹完应停住，实测 dy=${dyOf(rig).toFixed(2)}`);
  const [sx, sy] = scaleOf(rig);
  assert.ok(Math.abs(sx - sy) < 0.02, `弹完应恢复等比，实测 ${sx} / ${sy}`);

  ball.destroy();
});
