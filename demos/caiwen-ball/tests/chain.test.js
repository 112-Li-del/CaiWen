/* ============================================================
 * 思考链（10 → 11）：开场省略号 → 思考 2.5s → 还没输出就接翻知识库
 * ------------------------------------------------------------
 * 锁四件事：
 *   1. 省略号只在开场播一次（every: 0）——循环播会变成"想一下、回个神、再想一下"。
 *   2. dots 播完有一段"思考脸"的时间（不是点一结束就翻书）。
 *   3. dots(2.2s) + hold(2.5s) = 4.7s 到点自动接上 11：书渐显、emotion 真的变成 11
 *      （不是只换姿态——翻书要带道具书和扫视）。
 *   4. 链能被外部随时打断：模型开始输出 → 切 12，之后不许再跳回 11。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { node, walk, installFakeDom } from './fakedom.js';

const STEPS = (pump, frames) => { for (let i = 0; i < frames; i++) pump.step(16); };
/** rig 组：刚体变换每帧都带 `translate(100 105) rotate(`（CX CY 是球心，写死在引擎里） */
const rigOf = (host) => walk(host).find((n) => n.tag === 'g' && /translate\(100 105\) rotate\(/.test(n.attrs.transform || ''));
/** 书组：transform 带 rotate(-8) 的 g（引擎常驻，靠 opacity 收放） */
const bookOf = (host) => walk(host).find((n) => n.tag === 'g' && (n.attrs.transform || '').includes('rotate(-8)'));
/** 是否处于"缩成点"阶段 */
const isDot = (host) => /scale\(0\./.test(rigOf(host).attrs.transform);

test('省略号只在开场播一次，9s 后不会再缩成点', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('10');
  /* 摘掉链，让 10 一直停着——不然 4.7s 就被接到 11，看不出 dots 会不会循环 */
  ball.tune({ chain: null });

  const dotFrames = [];
  for (let i = 0; i < 780; i++) {          /* ≈12.5s，跨过原 every=9000 的循环点 */
    pump.step(16);
    if (isDot(host)) dotFrames.push(i * 16);
  }
  assert.ok(dotFrames.length > 30, '开场应该有省略号阶段');
  assert.ok(Math.max(...dotFrames) < 3000,
    `省略号应在 2.2s 内播完，实际持续到 ${Math.max(...dotFrames)}ms`);
  assert.ok(!dotFrames.some((t) => t > 8000),
    '省略号循环了（every>0）——"想一下回个神再想一下"很呆');
  ball.destroy();
});

test('思考链：点播完先思考 2.5s，4.7s 时自动接上翻知识库（11）', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const seen = [];
  const ball = create(host, { onChange: (id) => seen.push(id) });
  ball.setEmotion('10');

  STEPS(pump, 200);                                   /* ≈3.2s：点已播完，还在思考 */
  assert.equal(ball.emotion, '10', '3.2s 时不该已经翻书');
  assert.ok(!isDot(host), '3.2s 时应该已经变回思考脸（点只播 2.2s）');
  assert.ok(parseFloat(bookOf(host).attrs.opacity) < 0.05, '思考阶段不该出现书');

  STEPS(pump, 100);                                   /* ≈4.8s：越过 4.7s 的链触发点 */
  assert.equal(ball.emotion, '11', '4.7s 后应自动接上检索（翻知识库）');
  assert.ok(seen.includes('11'), `引擎没自动切表情：${JSON.stringify(seen)}`);

  STEPS(pump, 80);                                    /* ≈1.3s 让书渐显到位 */
  assert.ok(parseFloat(bookOf(host).attrs.opacity) > 0.9,
    `书应渐显：${bookOf(host).attrs.opacity}`);
  ball.destroy();
});

test('链能被外部打断：模型开始输出（切 12）后不会再跳回翻书', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('10');

  STEPS(pump, 190);                                   /* ≈3.0s，仍在思考 */
  ball.setEmotion('12');                              /* 模型开始吐字 */
  STEPS(pump, 320);                                   /* 再过 5.1s，早过了链的触发点 */
  assert.equal(ball.emotion, '12', '回答中被思考链拖回翻书了');
  assert.ok(parseFloat(bookOf(host).attrs.opacity) < 0.05, '回答中不该还摊着书');
  ball.destroy();
});
