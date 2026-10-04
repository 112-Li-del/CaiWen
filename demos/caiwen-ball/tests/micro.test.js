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
 *   5. 一个动作轮次内只做一次（调度挂在形变轮播轮次上）。
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

/**
 * 固定种子 PRNG（mulberry32）。
 * 为什么不用真随机：台词/表情都是加权抽样，跑几十轮要断言"三种台词都说过"，
 * 真随机下有万分之几的概率漏掉一种 → 测试会偶发飘红。用固定种子后整段运行
 * 可复现，跑通一次就永远跑通。
 */
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

  let round = false, widen = false, wink = false, awakeInsideNap = 0, maxRound = 0;

  /* 序列按权重区间走：surprise(<0.25) → widen(<0.625) → wink，循环保证三种都抽到。
   * 一个轮次只抽一次（12.6s/轮），所以帧数要够跨 8 轮，三种才都能轮到。 */
  withCycledRandom([0.05, 0.35, 0.75, 0.05, 0.35, 0.75, 0.05, 0.35, 0.75], () => {
    for (let i = 0; i < 6400; i++) {              /* ≈102s，8 轮形变+打盹周期 */
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

      if (isRound) { round = true; maxRound = Math.max(maxRound, L.w); }
      if (isWiden) widen = true;
      if (isWink) wink = true;
    }
  });

  assert.ok(round, '待机中应出现过"大圆眼"（惊讶）：两眼 w≈h 且大于基线');
  /* 大圆眼要够大才看得出"瞪"：29→33（待机基线宽 13，球直径 156） */
  assert.ok(maxRound >= 30, `大圆眼不够大：观测到的最大宽度只有 ${maxRound}`);
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
    for (let i = 0; i < 6400; i++) {              /* ≈102s，8 轮 */
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

/**
 * 帧序列 → 微表情区间：把连续 true 压成一段，允许 6 帧（≈100ms）以内的中断合并，
 * 免得 alpha 过渡期的抖动被算成两次。
 */
function collapseRuns(flags, msPerFrame) {
  const runs = [];
  let start = -1, gap = 0;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i]) { if (start < 0) start = i; gap = 0; }
    else if (start >= 0 && ++gap > 6) {
      /* (start+1)：第 i 帧观测到的是第 i+1 次 pump 之后的状态，时间要对齐，
       * 否则跨轮次边界那一帧会被算进上一轮。 */
      runs.push({ at: (start + 1) * msPerFrame, len: i - gap - start });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ at: (start + 1) * msPerFrame, len: flags.length - 1 - start });
  return runs;
}

test('一个动作轮次内只做一次微表情：做完就等下一轮', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const { STATES, morphTimeline } = await import('../src/states.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('01');
  const tl = morphTimeline(STATES['01'].morph);
  const ROUNDS = 5;
  const STEP = 16;
  const frames = Math.ceil((ROUNDS * tl.total) / STEP);

  const flags = [];
  withCycledRandom([0.05, 0.35, 0.75], () => {
    for (let i = 0; i < frames; i++) {
      pump.step(STEP);
      const ph = pump.now % tl.total;
      /* 打盹段（含进出的 fade 与眼形恢复尾巴）整只眼都换成睡眠的 26×26，尺寸天然
       * 偏离基线，不能算微表情——这段直接不计入（nap 的 fade 从 napStart-350 起，
       * 再往前留 350ms 余量）。触发窗口也刻意排在打盹之前。 */
      if (ph > tl.napStart - 700) { flags.push(false); continue; }
      const [L] = eyeRects(host).map(sizeOf);
      const lids = closedLines(host).map((n) => parseFloat(n.attrs.opacity) || 0);
      const wink = Math.max(...lids) > 0.8 && Math.min(...lids) < 0.2;
      /* 眨眼只压 normal 矩形的 Y 变换、不改 width/height 属性，所以尺寸判据不会被
       * 眨眼误伤；wink 才是唯一会让闭眼线亮起来的非睡眠情况。 */
      flags.push(wink || Math.abs(L.w - 13) > 2 || Math.abs(L.h - 30) > 3);
    }
  });

  /* 只留成段的：入场头几帧眼睛还在从 DOM 默认值逼近 13×30、轮次交替时刚从睡眠
   * 形恢复，都会短暂偏离基线，这些几十毫秒的碎片不是微表情（最短的 wink 也有
   * 760ms ≈ 47 帧）。 */
  const runs = collapseRuns(flags, STEP).filter((r) => r.len >= 25);
  const rounds = runs.map((r) => Math.floor(r.at / tl.total));

  assert.ok(runs.length >= ROUNDS - 1,
    `${ROUNDS} 个轮次里只做了 ${runs.length} 次微表情——基本每轮都该来一次`);
  assert.ok(runs.length <= ROUNDS,
    `${ROUNDS} 个轮次里做了 ${runs.length} 次——一个动作轮次内只能做一次`);
  assert.equal(new Set(rounds).size, rounds.length,
    `有两个微表情落在同一个动作轮次里：${JSON.stringify(rounds)}`);
  /* 顺带锁时长：dur 从 0.76~1.1s 加到 1.2~1.7s，一闪而过看不清。
   * 40 帧 = 640ms，只检测闭眼线的 wink（1.2s）也够得着。 */
  assert.ok(runs.every((r) => r.len >= 40),
    `有微表情短于 640ms：${JSON.stringify(runs.map((r) => r.len * 16))}`);

  ball.destroy();
});

test('微表情带台词：做表情时换一句，做完换回待机文案', async () => {
  const pump = installFakeDom();
  /* 开"减弱动效"：typeline 会跳过逐字动画直接整段显示，否则它靠真实 setTimeout
   * 逐字推进，而这里的帧是同步泵的，永远读不到文字。 */
  globalThis.window.matchMedia = () => ({ matches: true });
  const { create } = await import('../src/engine.js');
  const { STATES } = await import('../src/states.js');
  const host = node('div');
  const tipHost = node('div');
  /* 引擎用 `opts.tip instanceof Element` 认领提示节点，假 DOM 的 node 不是真 Element */
  Object.setPrototypeOf(tipHost, globalThis.Element.prototype);
  const ball = create(host, { tip: tipHost });
  ball.setEmotion('01');

  const IDLE = STATES['01'].tip;
  /* 「底噪台词」= 表情自己的 tip，或第 3 轮起轮换出来的一句（见 tips.test.js）。
   * 微表情做完换回的是**当时**的底噪，不一定是 IDLE 这一句。 */
  const BANK = new Set(STATES['01'].tipLines || []);
  const isIdleNoise = (t) => t === IDLE || BANK.has(t);
  const pools = {};
  for (const it of STATES['01'].micro.items) pools[it.key] = it.lines;
  const all = new Set(Object.values(pools).flat());
  const readTip = () => (tipHost.children[0] ? tipHost.children[0].textContent : '');

  const seq = [];
  const push = () => { const t = readTip(); if (t && seq[seq.length - 1] !== t) seq.push(t); };
  push();                                    /* 刚切进来应该是待机自己的文案 */
  const orig = Math.random;
  Math.random = seededRandom(7);
  for (let i = 0; i < 16000; i++) {          /* ≈256s，20 轮，够三种台词都轮上 */
    pump.step(16);
    push();
  }
  Math.random = orig;

  const said = seq.filter((t) => !isIdleNoise(t));
  assert.equal(seq[0], IDLE, '刚进入待机时下方应是待机文案');
  assert.ok(said.length >= 10, `20 个轮次里只换过 ${said.length} 次台词——一个轮次该有一次`);
  for (const t of said) {
    assert.ok(all.has(t), `出现了台词池之外的一句：${t}`);
  }
  /* 表情做完必须把文案换回底噪（前两轮是待机文案，之后是轮换出来的句子），
   * 不能一直挂着"震惊！" */
  for (let i = 0; i < seq.length - 1; i++) {
    if (!isIdleNoise(seq[i])) {
      assert.ok(isIdleNoise(seq[i + 1]),
        `台词「${seq[i]}」之后没换回底噪（停在 ${seq[i + 1]}）`);
    }
  }
  /* 三种表情各自的台词都说过了 */
  for (const key of Object.keys(pools)) {
    assert.ok(said.some((t) => pools[key].includes(t)),
      `${key} 的台词一次都没说过：${JSON.stringify(pools[key])}`);
  }

  ball.destroy();
});
