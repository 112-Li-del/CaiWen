/* ============================================================
 * 书写（13）：检索完到回答中之间的过门动作
 * ------------------------------------------------------------
 * 流程：检索完（11）→ 13 钢笔写字 2.4s → 12 回答中（大圆眼）
 *       → 回答完直接 → 20 完成（彩带）。（感叹过门 23 已退役。）
 * 锁四件事：
 *   1. 13：球缩没（rig scale→0）、钢笔显形；走位是"划过去一行再回中间"
 *      （x 越过中点到行尾后收回 CX），且不留墨迹（DOM 里没有墨线）。
 *   2. 13：2.4s 后自动接「回答中」（12），钢笔渐隐收场（opacity→0）。
 *   3. 契约：12 右眼是大圆眼（w==h 且大于左眼）；13 带 pen；
 *      不许再出现 notif / exclaim（徽章、感叹方案已废弃）。
 *   4. 待机（01）没有笔、球不缩。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { node, walk, installFakeDom } from './fakedom.js';

const STEPS = (pump, frames) => { for (let i = 0; i < frames; i++) pump.step(16); };
/** rig 组：刚体变换每帧都带 `translate(100 105) rotate(`（CX CY 是球心，写死在引擎里） */
const rigOf = (host) => walk(host).find((n) => n.tag === 'g' && /translate\(100 105\) rotate\(/.test(n.attrs.transform || ''));
/** 笔尖：72 边形采样轮廓（60+ 个 " L" 顶点）——形状照用户给的还原稿，
 * 不是手搓的扇贝点；感叹条是 4 个 Q 段，不会撞 */
const nibOf = (host) => walk(host).find((n) => n.tag === 'path' && n.attrs.fill === '#73101F' && ((n.attrs.d || '').match(/ L/g) || []).length > 60);
/** 笔杆：stroke-width 52 的圆角粗条（墨线方案已废弃，全树唯一） */
const penBarOf = (host) => walk(host).find((n) => n.tag === 'line' && n.attrs['stroke-width'] === '52');
/** 钢笔根组 = 扇贝点往上三层（penTilt → penMove → penG），opacity 挂在最外层 */
const penGOf = (host) => { const nib = nibOf(host); return nib && nib.parent.parent.parent; };
/** 走位组 = 扇贝点的祖父（penTilt → penMove），transform 是每帧更新的 translate+rotate */
const moveOf = (host) => { const nib = nibOf(host); return nib && nib.parent.parent; };
const moveXOf = (host) => parseFloat(moveOf(host).attrs.transform.match(/translate\(([\d.-]+) /)[1]);
const opacity = (n) => parseFloat(n.attrs.opacity);

test('书写（13）：球缩没、钢笔显形，划过去一行再回到中间（不留墨迹）', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('13');

  STEPS(pump, 40);                                    /* ≈0.64s，正划向行尾 */
  assert.ok(opacity(penGOf(host)) > 0.5, `钢笔应已显形：${penGOf(host).attrs.opacity}`);
  /* 形状锁：照还原稿的数值不许被"顺手优化"掉。
   * 笔杆端点即圆头圆心，倾角 = atan(dx / |dy|) 约 17.7°（上端向右） */
  const bar = penBarOf(host);
  assert.ok(bar, '书写时应该有笔杆（圆角粗条）');
  assert.equal(+bar.attrs.x1, 122.6, '笔杆下端 x 应保持还原稿值');
  assert.equal(+bar.attrs.y1, 157.8, '笔杆下端 y 应保持还原稿值');
  assert.equal(+bar.attrs.x2, 155.9, '笔杆上端 x 应保持还原稿值');
  assert.equal(+bar.attrs.y2, 53.7, '笔杆上端 y 应保持还原稿值');
  const deg = Math.atan2(155.9 - 122.6, 157.8 - 53.7) * 180 / Math.PI;
  assert.ok(Math.abs(deg - 17.7) < 0.5, `笔杆倾角应约 17.7°：${deg.toFixed(2)}°`);
  /* 笔尖必须是采样出来的凹凸轮廓（72 边形），不是手搓的圆/扇贝 */
  const nib = nibOf(host);
  assert.ok(nib, '钢笔应带采样还原的笔尖');
  assert.ok(((nib.attrs.d || '').match(/ L/g) || []).length >= 60,
    `笔尖应是轮廓采样（60+ 顶点）：${((nib.attrs.d || '').match(/ L/g) || []).length}`);
  /* 等比映射：笔尖中心 (103, 227) 落在组原点，整体比球小一号（总高 115 < 球 156） */
  const penMap = nib.parent.attrs.transform;
  assert.ok(/^translate\(-51\.50 -113\.50\) scale\(0\.5\)$/.test(penMap),
    `钢笔应把笔尖对齐组原点并缩小到 0.5：${penMap}`);
  const rig = rigOf(host).attrs.transform;
  assert.ok(/scale\(0\.0/.test(rig), `球应缩到接近没有：${rig.slice(0, 60)}`);
  const xEarly = moveXOf(host);
  /* 起笔在行首（CX-40=60），0.64s 时应已划过中间（>100） */
  assert.ok(xEarly > 60 && xEarly < 160, `笔应在一行上走：x=${xEarly}`);

  STEPS(pump, 20);                                    /* ≈0.96s，抵达行尾（CX+40=140） */
  const xFar = moveXOf(host);
  assert.ok(xFar > xEarly + 3, `笔应继续向行尾划：${xEarly} → ${xFar}`);

  STEPS(pump, 75);                                    /* ≈2.16s，回程已近终点 */
  const xBack = moveXOf(host);
  assert.ok(Math.abs(xBack - 100) < 4, `写完应回到中间：x=${xBack}`);
  /* 不留墨迹：DOM 里不该有任何 line（墨线方案已废弃） */
  assert.ok(!walk(host).some((n) => n.tag === 'line' && n.attrs['stroke-width'] === '6'),
    '不该再画墨线');
  ball.destroy();
});

test('书写（13）：2.4s 后自动接回答中（12），钢笔渐隐收场', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('13');

  STEPS(pump, 100);                                   /* ≈1.6s，还在写 */
  assert.equal(ball.emotion, '13', '1.6s 时不该已经进入回答中');
  STEPS(pump, 60);                                    /* ≈2.6s，越过 2.4s 的链触发点 */
  assert.equal(ball.emotion, '12', '2.4s 后应自动接「回答中」');

  STEPS(pump, 40);                                    /* ≈0.64s 让笔渐隐 */
  assert.ok(opacity(penGOf(host)) < 0.05,
    `切到回答中后钢笔应收起：${penGOf(host).attrs.opacity}`);
  ball.destroy();
});

test('契约：12 两只等大窄长胶囊眼 + 轨道环/眼睛滑行、13 带笔，且徽章/感叹方案不许回来', async () => {
  const { STATES } = await import('../src/states.js');
  const s12 = STATES['12'];
  /* 对齐 bloub orbit（states.ts pair(0.18, 0.34~0.41)）：两只等大的窄长胶囊，
   * 不再是大小眼；按 R=78 折算约 14×30。 */
  assert.equal(s12.eyeL.w, s12.eyeR.w, '左右眼应等宽');
  assert.equal(s12.eyeL.h, s12.eyeR.h, '左右眼应等高');
  assert.ok(s12.eyeL.h > s12.eyeL.w * 1.8, `眼睛应是窄长胶囊：${s12.eyeL.w}×${s12.eyeL.h}`);
  assert.ok(s12.orbit && s12.orbit.gazeHz === 6.5 && s12.orbit.gazeAmp === 65,
    '回答中应带 bloub 实测的眼睛滑行契约（6.5 rad/s、±65°）');
  assert.equal(s12.orbit.spin, undefined, '球面不再全速自转（旋转交给轨道环与眼睛）');

  const s13 = STATES['13'];
  assert.equal(s13.chain.to, '12', '书写完应接回答中');
  assert.equal(s13.chain.hold, 2400, '书写 2.4s');
  assert.ok(s13.pen && s13.pen.dur === 2400, '应带 pen 契约且与链对齐');
  assert.ok(!('notif' in s13), '徽章方案已废弃，不许回来');
  assert.ok(!('exclaim' in s13) && !('23' in STATES), '感叹方案已退役，不许回来');
});

test('待机（01）：没有笔、球不缩', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('01');
  STEPS(pump, 60);
  assert.ok(opacity(penGOf(host)) < 0.02, '待机不该有钢笔');
  assert.ok(!/scale\(0\./.test(rigOf(host).attrs.transform), '待机球不该缩');
  ball.destroy();
});
