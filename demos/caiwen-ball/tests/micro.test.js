/* ============================================================
 * 待机微表情：大圆眼（惊讶）/ 睁大胶囊 / 单眨眼 wink
 * ------------------------------------------------------------
 * 锁四件事：
 *   1. pickWeighted 是加权抽样（可注入随机 → 确定性可测），空清单返回 null。
 *   2. 跑一段待机，三种微表情都出现过：圆眼 w≈h、睁大 h 明显变大且仍是胶囊、
 *      wink 只有一侧闭眼线亮起。
 *   3. 睡眠/打盹期间不出现微表情——睡着的脸不做表情（曾因为微表情盖掉闭眼线
 *      ，导致"打盹时突然瞪大眼"）。
 *   4. 微表情是短时的：不会一直停在圆眼上（结束后回到基础 13×30）。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { node, walk, installFakeDom } from './fakedom.js';
import { pickWeighted } from '../src/math.js';

/** 每只眼的两块 rect 顺序是 normal, wide（buildEye 里按此创建） */
function eyeRects(host) {
  const all = walk(host).filter((n) => n.tag === 'rect' && n.attrs.fill === '#FFF6DC');
  return [all[0], all[2]];      /* 左眼 normal、右眼 normal */
}
const closedLines = (host) => walk(host).filter((n) => n.tag === 'line' && n.attrs['stroke-width'] === '6.5');

const sizeOf = (r) => ({ w: parseFloat(r.attrs.width), h: parseFloat(r.attrs.height), op: parseFloat(r.attrs.opacity) });

/** 注入确定性随机：cycling 数组轮转，保证三种微表情按权重依次被抽到 */
function withCycledRandom(values, fn) {
  const orig = Math.random;
  let i = 0;
  Math.random = () => values[i++ % values.length];
  try { return fn(); } finally { Math.random = orig; }
}

test('pickWeighted：加权抽样，空清单与非法权重都有兜底', () => {
  const items = [{ key: 'a', weight: 2 }, { key: 'b', weight: 3 }, { key: 'c', weight: 3 }];
  assert.equal(pickWeighted(items, () => 0.1).key, 'a');
  assert.equal(pickWeighted(items, () => 0.3).key, 'b');
  assert.equal(pickWeighted(items, () => 0.9).key, 'c');
  assert.equal(pickWeighted([], () => 0.5), null);
  assert.equal(pickWeighted(null), null);
  /* 权重 0 / 负数 / 缺失 都按 1 处理，不至于把某项永远排除或抽不到 */
  assert.equal(pickWeighted([{ key: 'x', weight: 0 }, { key: 'y' }], () => 0.1).key, 'x');
  assert.equal(pickWeighted([{ key: 'x', weight: -5 }, { key: 'y' }], () => 0.9).key, 'y');
});

test('待机微表情：三种都出现（圆眼 / 睁大胶囊 / 单眨眼），且睡眠期间不做表情', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const { STATES, morphTimeline } = await import('../src/states.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('01');                 /* now 仍是 0 → morphAnchor=0，相位 = pump 时间 */
  const tl = morphTimeline(STATES['01'].morph);

  let round = false, widen = false, wink = false, awakeInsideNap = 0;

  /* 序列按权重区间走：surprise(<0.25) → widen(<0.625) → wink，循环保证三种都抽到 */
  withCycledRandom([0.05, 0.35, 0.75, 0.05, 0.35, 0.75, 0.05, 0.35, 0.75], () => {
    for (let i = 0; i < 2600; i++) {              /* ≈41s，跨 3 轮形变+打盹周期 */
      pump.step(16);
      const [L, R] = eyeRects(host).map(sizeOf);
      const lids = closedLines(host).map((n) => parseFloat(n.attrs.opacity) || 0);

      /* 打盹窗的核心段（避开首尾 fade 与 alpha 过渡）：这段里眼睛必须保持睡眠的
       * 闭眼形，不能有微表情把眼睛换成圆眼/睁大/wink。
       * 注意别用"睡着才算睡着"当判据——微表情一旦盖掉闭眼线，那个判据就自己失效了，
       * 所以这里按**时间相位**判定，与渲染状态无关。 */
      const ph = pump.now % tl.total;
      if (ph > tl.napStart + 700 && ph < tl.napEnd - 300) {
        if (Math.max(L.op, R.op) > 0.4) awakeInsideNap++;   /* normal 眼形还亮着 = 没在睡 */
      }

      const bothNormal = L.op > 0.85 && R.op > 0.85;
      /* 圆眼：w≈h（rect 的 rx=w/2 正好是圆），且明显大于待机基线 13×30 */
      const isRound = bothNormal && Math.abs(L.w - L.h) < 3 && L.w > 20 && Math.abs(R.w - R.h) < 3;
      /* 睁大：仍是胶囊（高明显大于宽），但比基线 30 高出一截 */
      const isWiden = bothNormal && L.h > 33 && L.h - L.w > 12 && L.w > 14 && Math.abs(L.w - R.w) < 2;
      /* wink：只有一侧闭眼线亮，另一侧仍是睁着的（不是眨眼就是闭眼线全亮） */
      const isWink = Math.max(...lids) > 0.8 && Math.min(...lids) < 0.2;

      if (isRound) round = true;
      if (isWiden) widen = true;
      if (isWink) wink = true;
    }
  });

  assert.ok(round, '待机中应出现过"大圆眼"（惊讶）：两眼 w≈h 且大于基线');
  assert.ok(widen, '待机中应出现过"睁大"（仍是胶囊，但比 13×30 大）');
  assert.ok(wink, '待机中应出现过"单眨眼 wink"（只有一侧闭眼线亮起）');
  assert.ok(awakeInsideNap === 0,
    `睡眠/打盹期间出现了 ${awakeInsideNap} 帧非睡眠眼形——微表情没被睡眠门控掐掉`);

  ball.destroy();
});

test('微表情不连续重复：做完一种，下一次不还是它', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('01');

  /* 恒定随机 0.05：永远落在 surprise 的权重桶里。没有去重的话，接下来每一次
   * 都会是 surprise——观感就是"一直在瞪大眼"（用户实际撞到的是连着 wink）。 */
  const kinds = [];
  withCycledRandom([0.05], () => {
    let prev = '';
    for (let i = 0; i < 4000; i++) {              /* ≈64s，约 20 次微表情 */
      pump.step(16);
      const [L] = eyeRects(host).map(sizeOf);
      const lids = closedLines(host).map((n) => parseFloat(n.attrs.opacity) || 0);
      let cur = '';
      if (Math.max(...lids) > 0.8 && Math.min(...lids) < 0.2) cur = 'wink';
      else if (L.op > 0.85 && Math.abs(L.w - L.h) < 3 && L.w > 20) cur = 'round';
      else if (L.op > 0.85 && L.h > 33) cur = 'widen';
      if (cur && cur !== prev) kinds.push(cur);
      prev = cur;
    }
  });

  const uniq = [...new Set(kinds)];
  assert.ok(uniq.length >= 2,
    `恒定随机下也应出现不同微表情（去重生效），实际只有 ${JSON.stringify(uniq)}`);
  for (let i = 1; i < kinds.length; i++) {
    assert.notEqual(kinds[i], kinds[i - 1],
      `第 ${i} 次微表情 ${kinds[i]} 与上一次 ${kinds[i - 1]} 相同——又连着做同一个了`);
  }

  ball.destroy();
});

test('微表情是短时的：大部分时间停在基础眼形，不会一直瞪着', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('01');

  let base = 0, off = 0;
  withCycledRandom([0.05, 0.35, 0.75], () => {
    for (let i = 0; i < 2600; i++) {              /* ≈41s */
      pump.step(16);
      const [L] = eyeRects(host).map(sizeOf);
      /* 基础眼形 13×30；微表情期间尺寸会明显偏离 */
      if (Math.abs(L.w - 13) < 1.5 && Math.abs(L.h - 30) < 2) base++;
      else off++;
    }
  });

  assert.ok(off > 0, '应观测到微表情（尺寸偏离基础眼形）');
  assert.ok(base / (base + off) > 0.6,
    `微表情不应占据大部分时间：基础眼形只占 ${(100 * base / (base + off)).toFixed(0)}%`);

  ball.destroy();
});
