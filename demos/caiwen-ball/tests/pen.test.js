/* ============================================================
 * 书写（13）与感叹（23）：两条过门动作
 * ------------------------------------------------------------
 * 流程：检索完（11）→ 13 钢笔写字 2.4s → 12 回答中（大圆眼）
 *       → 回答完 → 23 感叹号 1s → 20 完成（彩带）。
 * 锁六件事：
 *   1. 13：球缩没（rig scale→0）、钢笔显形；走位是"划过去一行再回中间"
 *      （x 越过中点到行尾后收回 CX），且不留墨迹（DOM 里没有墨线）。
 *   2. 13：2.4s 后自动接「回答中」（12），钢笔渐隐收场（opacity→0）。
 *   3. 23：球缩成"!"的点（rig 挂 translate(100 139) scale(0.17x)），
 *      感叹条弹出（opacity→1，且带 outBack 的放大）。
 *   4. 23：1s 后自动接「完成」（20）。
 *   5. 契约：12 右眼是大圆眼（w==h 且大于左眼）；13 带 pen、23 带 exclaim；
 *      不许再出现 notif（徽章方案已废弃）。
 *   6. 待机（01）没有笔、没有感叹条、球不缩。
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
/** 感叹条：fill #73101F 且路径用 Q 段（笔尖扇贝点是 smoothClosedPath 的 C 段，不撞） */
const exBarOf = (host) => walk(host).find((n) => n.tag === 'path' && n.attrs.fill === '#73101F' && (n.attrs.d || '').includes('Q '));
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

test('感叹（23）：球缩成"!"的点，感叹条弹出；1s 后接完成（20）', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('23');

  STEPS(pump, 30);                                    /* ≈0.5s，感叹已立起来 */
  const bar = exBarOf(host);
  assert.ok(bar, '感叹时应该有感叹条');
  assert.ok(opacity(bar) > 0.5, `感叹条应已显形：${bar.attrs.opacity}`);

  /* 从头重进一次采样弹出曲线：outBack 中途应有过冲（scale > 1），
   * 收在 1 附近——死板的淡入（峰值 ≤1）或停在峰值都不合格 */
  ball.setEmotion('01');
  STEPS(pump, 30);                                    /* 让旧状态彻底收场 */
  ball.setEmotion('23');
  let peak = 0;
  for (let i = 0; i < 24; i++) {                      /* ≈0.38s，覆盖 0.32s 的弹出 */
    pump.step(16);
    const m = bar.attrs.transform.match(/scale\(([\d.]+)\)/);
    if (m) peak = Math.max(peak, parseFloat(m[1]));
  }
  assert.ok(peak > 1.02, `感叹条弹出应带过冲：峰值 ${peak.toFixed(3)}`);
  STEPS(pump, 10);
  const rest = parseFloat(bar.attrs.transform.match(/scale\(([\d.]+)\)/)[1]);
  assert.ok(Math.abs(rest - 1) < 0.02, `弹出后应落回 1：${rest.toFixed(3)}`);

  const rig = rigOf(host).attrs.transform;
  assert.ok(/translate\(100 139\) scale\(0\.1/.test(rig),
    `球应缩成 17% 并挪到感叹号的点位：${rig.slice(0, 70)}`);

  STEPS(pump, 40);                                    /* ≈1.1s，越过 1s 的链触发点 */
  assert.equal(ball.emotion, '20', '1s 后应自动接「完成」');
  ball.destroy();
});

test('契约：12 大圆眼、13 带笔、23 带感叹，且徽章方案不许回来', async () => {
  const { STATES } = await import('../src/states.js');
  const s12 = STATES['12'];
  assert.equal(s12.eyeR.w, s12.eyeR.h, '右眼应是圆（w==h）');
  assert.ok(s12.eyeR.w > s12.eyeL.w, '右眼应比左眼大（目标图就是大小眼）');
  assert.ok(s12.eyeR.w >= 28, `右眼要够大（目标图的大圆眼）：${s12.eyeR.w}`);

  const s13 = STATES['13'];
  assert.equal(s13.chain.to, '12', '书写完应接回答中');
  assert.equal(s13.chain.hold, 2400, '书写 2.4s');
  assert.ok(s13.pen && s13.pen.dur === 2400, '应带 pen 契约且与链对齐');
  assert.ok(!('notif' in s13), '徽章方案已废弃，不许回来');

  const s23 = STATES['23'];
  assert.equal(s23.chain.to, '20', '感叹完应接完成');
  assert.equal(s23.chain.hold, 1000, '感叹 1s');
  assert.ok(s23.exclaim && s23.exclaim.dur === 1000, '应带 exclaim 契约');
});

test('待机（01）：没有笔、没有感叹条、球不缩', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('01');
  STEPS(pump, 60);
  assert.ok(opacity(penGOf(host)) < 0.02, '待机不该有钢笔');
  assert.ok(opacity(exBarOf(host)) < 0.02, '待机不该有感叹条');
  assert.ok(!/scale\(0\./.test(rigOf(host).attrs.transform), '待机球不该缩');
  ball.destroy();
});
