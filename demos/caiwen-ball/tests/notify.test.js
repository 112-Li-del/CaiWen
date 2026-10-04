/* ============================================================
 * 提醒徽章（13）：照 bloub notify 复刻的通知徽章 + 球身缺口
 * ------------------------------------------------------------
 * 锁五件事：
 *   1. 徽章存在且贴在右上轮廓外：圆心落在圆周上（≈1.003R，右上 42°），
 *      半径 0.15R——不是随手贴在球边上的圆点。
 *   2. 球身真的被咬出缺口：带 notif 的状态给球身组挂上 mask，洞比徽章大一圈
 *      （0.054R 的等宽咬痕），且洞跟着徽章一起长。
 *   3. 弹入是"过冲再落回"：峰值 +14%（bloub 里唯一的一处弹簧），
 *      之后回到 1——不许停在峰值，也不许没有过冲。
 *   4. 2.4s 后自动接「回答中」（12），徽章缩回去、mask 摘掉（常挂是白给的开销）。
 *   5. 不带 notif 的状态（待机）没有徽章也没有 mask。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { node, walk, installFakeDom } from './fakedom.js';

const STEPS = (pump, frames) => { for (let i = 0; i < frames; i++) pump.step(16); };
const CX = 100, CY = 105, R = 78;

/** 徽章：fill #2496e8 的 circle（引擎里只有它是这个颜色） */
const badgeOf = (host) => walk(host).find((n) => n.tag === 'circle' && n.attrs.fill === '#2496e8');
/** 徽章所在的组（父节点），transform 上是"绕徽章圆心缩放" */
const badgeG = (host) => badgeOf(host) && badgeOf(host).parent;
const scaleOf = (g) => parseFloat((g.attrs.transform.match(/scale\(([-\d.]+)\)/) || [])[1]);
/** 缺口：mask 里的黑洞（黑色 circle） */
const holeOf = (host) => walk(host).find((n) => n.tag === 'circle' && n.attrs.fill === '#000');
/** 球身组：被 mask 的那一层（洞和徽章都在它这里对齐） */
const maskedOf = (host) => walk(host).find((n) => n.attrs.mask);

test('提醒（13）：徽章贴在右上轮廓上，尺寸照 bloub 的测量值', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('13');
  STEPS(pump, 60);                                    /* ≈1s，弹入早已结束 */

  const badge = badgeOf(host);
  assert.ok(badge, '提醒时应该有一枚徽章');
  const cx = parseFloat(badge.attrs.cx);
  const cy = parseFloat(badge.attrs.cy);
  const dist = Math.hypot(cx - CX, cy - CY);
  /* 圆心正好压在圆周上（1.003R），右上 42° */
  assert.ok(Math.abs(dist - 1.003 * R) < 1.5, `徽章应压在圆周上：实测 ${dist.toFixed(1)}`);
  assert.ok(cx > CX && cy < CY, `徽章应在右上：(${cx}, ${cy})`);
  const deg = (Math.atan2(CY - cy, cx - CX) * 180) / Math.PI;
  assert.ok(Math.abs(deg - 42) < 1.5, `徽章应在右上 42°：实测 ${deg.toFixed(1)}°`);
  assert.ok(Math.abs(parseFloat(badge.attrs.r) - 0.15 * R) < 0.5, '徽章半径应为 0.15R');
  ball.destroy();
});

test('提醒（13）：球身被咬出缺口，洞比徽章大一圈且跟着长', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('13');

  STEPS(pump, 2);                                     /* ≈32ms，刚破土 */
  const gMid = maskedOf(host);
  assert.ok(gMid && /^url\(#cw-notch-\d+\)$/.test(gMid.attrs.mask),
    '提醒状态应给球身挂上缺口 mask（球身/经线/高光一起被咬掉）');
  const holeYoung = parseFloat(holeOf(host).attrs.r);
  assert.ok(holeYoung > 0, '缺口应该随着徽章长出来');

  STEPS(pump, 60);                                    /* ≈1s，弹入结束 */
  const hole = parseFloat(holeOf(host).attrs.r);
  const badge = parseFloat(badgeOf(host).attrs.r);
  /* 咬痕宽度 = 0.054R ≈ 4.2px，且是**等宽**的一圈：洞 = 徽章 + 一个 margin */
  assert.ok(Math.abs(hole - (badge + 0.054 * R)) < 0.6,
    `缺口应比徽章大一圈（0.054R）：洞 ${hole} vs 徽章 ${badge}`);
  assert.ok(hole > holeYoung, `缺口应跟着徽章一起长大：${holeYoung} → ${hole}`);
  /* 注意别拿"弹入途中"当最终值：过冲到 +14% 时洞比停稳后还大 */
  ball.destroy();
});

test('提醒（13）：弹入过冲到 +14% 再落回 1', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('13');

  /* 峰值出现在 0.55×280ms ≈ 154ms 处，取 144ms 附近采样 */
  let peak = 0;
  for (let i = 0; i < 10; i++) { pump.step(16); peak = Math.max(peak, scaleOf(badgeG(host))); }
  assert.ok(peak > 1.05, `弹入应过冲（峰值 +14%）：实测 ${peak.toFixed(3)}`);
  assert.ok(peak < 1.2, `过冲别过头：${peak.toFixed(3)}`);

  STEPS(pump, 60);                                    /* ≈1s，早已落回 */
  const rest = scaleOf(badgeG(host));
  assert.ok(Math.abs(rest - 1) < 0.02, `弹入后应落回 1：实测 ${rest.toFixed(3)}`);
  ball.destroy();
});

test('提醒（13）：2.4s 后自动接回答中（12），徽章缩回、mask 摘掉', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('13');

  STEPS(pump, 100);                                   /* ≈1.6s，还在提醒 */
  assert.equal(ball.emotion, '13', '1.6s 时不该已经开始回答');
  STEPS(pump, 60);                                    /* ≈2.6s，越过 2.4s 的链触发点 */
  assert.equal(ball.emotion, '12', '2.4s 后应自动接「回答中」');

  STEPS(pump, 60);                                    /* ≈1s，让徽章缩回去 */
  assert.ok(parseFloat(badgeG(host).attrs.opacity) < 0.02,
    `切到回答中后徽章应收起：${badgeG(host).attrs.opacity}`);
  assert.ok(!maskedOf(host), '切走后不该还挂着 mask（每帧一次离屏合成，白给的开销）');
  ball.destroy();
});

test('待机（01）：没有徽章，也不挂 mask', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('01');
  STEPS(pump, 60);
  assert.ok(parseFloat(badgeG(host).attrs.opacity) < 0.02, '待机时不该显示徽章');
  assert.ok(!maskedOf(host), '待机时不该挂缺口 mask');
  ball.destroy();
});
