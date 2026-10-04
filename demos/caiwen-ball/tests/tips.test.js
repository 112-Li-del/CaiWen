/* ============================================================
 * 待机台词轮换（src/lines.js + states 的 tipLines / tipRounds）
 * ------------------------------------------------------------
 * 锁四件事：
 *   1. 台词库本身：≥100 句、无重复、每句够短（≤12 字，长了会折行顶出容器）。
 *   2. pickLine 会避开上一句。
 *   3. 前 2 个动作轮次仍说表情自己的 tip（刚进门就换台词像切错了表情）。
 *   4. 第 3 轮起每个轮次换一句：句子来自台词库，相邻轮次不重复。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { node, installFakeDom } from './fakedom.js';

/** 固定种子 PRNG（mulberry32），避免真随机下的偶发飘红 */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 造一个带提示节点的球；typeline 走"减弱动效"分支直接整段显示，同步泵帧才读得到字 */
async function makeBall() {
  globalThis.window.matchMedia = () => ({ matches: true });
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const tipHost = node('div');
  Object.setPrototypeOf(tipHost, globalThis.Element.prototype);
  const ball = create(host, { tip: tipHost });
  return { ball, readTip: () => (tipHost.children[0] ? tipHost.children[0].textContent : '') };
}

test('台词库：≥100 句、无重复、每句 ≤12 字', async () => {
  const { IDLE_LINES } = await import('../src/lines.js');
  assert.ok(IDLE_LINES.length >= 100, `只有 ${IDLE_LINES.length} 句，说不够 100 轮`);
  assert.equal(new Set(IDLE_LINES).size, IDLE_LINES.length, '台词库里有重复的句子');
  for (const s of IDLE_LINES) {
    assert.ok(typeof s === 'string' && s.trim().length > 0, '出现空句');
    const n = Array.from(s).length;
    assert.ok(n <= 12, `「${s}」有 ${n} 字，超过 12 字会在球的台词框里折行`);
  }
});

test('pickLine 避开上一句', async () => {
  const { pickLine, IDLE_LINES } = await import('../src/lines.js');
  const prev = IDLE_LINES[0];
  for (let i = 0; i < 50; i++) {
    assert.notEqual(pickLine(IDLE_LINES, prev), prev, '连着说同一句了');
  }
  /* 只有一句时躲不掉，也不能返回空 */
  assert.equal(pickLine(['唯一一句'], '唯一一句'), '唯一一句');
  assert.equal(pickLine([], ''), '');
});

test('前两个动作轮次说表情自己的 tip，第 3 轮起轮换', async () => {
  const pump = installFakeDom();
  const { ball, readTip } = await makeBall();
  const { STATES, morphTimeline } = await import('../src/states.js');
  const { IDLE_LINES } = await import('../src/lines.js');
  const IDLE = STATES['01'].tip;
  const BANK = new Set(IDLE_LINES);

  ball.setEmotion('01');
  const total = morphTimeline(STATES['01'].morph).total;

  const orig = Math.random;
  Math.random = seededRandom(11);
  const perRound = [];                     /* 每一轮结束时正在显示的台词 */
  const STEP = 16;
  const ROUNDS = 8;
  let seen = readTip();
  for (let i = 0; i < Math.ceil((ROUNDS * total) / STEP); i++) {
    pump.step(STEP);
    const t = readTip();
    if (t) seen = t;
    const r = Math.floor(pump.now / total);
    perRound[r] = seen;
  }
  Math.random = orig;

  /* 第 0、1 轮：一直是待机自己的文案（轮换从第 3 轮 = index 2 才开始） */
  for (let r = 0; r < 2; r++) {
    assert.equal(perRound[r], IDLE, `第 ${r + 1} 轮就换台词了：${perRound[r]}`);
  }
  /* 第 3 轮起：每轮一句，来自台词库 */
  for (let r = 2; r < ROUNDS; r++) {
    const t = perRound[r];
    assert.ok(BANK.has(t), `第 ${r + 1} 轮显示的「${t}」不在台词库里`);
  }
  /* 相邻轮次不重复 */
  for (let r = 3; r < ROUNDS; r++) {
    assert.notEqual(perRound[r], perRound[r - 1],
      `第 ${r} 轮和第 ${r + 1} 轮说了同一句：${perRound[r]}`);
  }

  ball.destroy();
});
