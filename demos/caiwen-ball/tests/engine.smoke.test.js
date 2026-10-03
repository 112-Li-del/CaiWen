/* ============================================================
 * 假 DOM 冒烟：跑真实帧循环，验证时序类行为。
 * ------------------------------------------------------------
 * 分层设计的好处在这里兑现——除了 engine，其他层都是纯函数，
 * 而 engine 只需要一个极简假 DOM 就能在 Node 里整帧跑起来，
 * 于是"每一轮都要打盹"这种时序 bug 可以被测试锁住，不用靠肉眼盯。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { node, walk, installFakeDom } from './fakedom.js';

test('待机每个周期都会打盹，且打盹发生在形变轮播之后', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const { STATES, morphTimeline } = await import('../src/states.js');

  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('01');

  /* 闭眼线：closed 是唯一 stroke-width=6.5 的 line（叉眼的两条线不设该属性） */
  const closedLines = () => walk(host).filter((n) => n.tag === 'line' && n.attrs['stroke-width'] === '6.5');
  const lidOpen = () => Math.min(...closedLines().map((n) => parseFloat(n.attrs.opacity) || 0));

  const tl = morphTimeline(STATES['01'].morph);
  assert.ok(closedLines().length === 2, '应找到左右两条闭眼线');

  const naps = [];           /* 每次"睡着"的起始时刻 */
  let t = 0;
  let wasAsleep = false;
  const cycles = 2.5;
  const total = tl.total * cycles;
  while (t < total) {
    t = pump.step(16);
    const asleep = lidOpen() > 0.5;
    if (asleep && !wasAsleep) naps.push(t);
    wasAsleep = asleep;
  }

  assert.ok(naps.length >= 2,
    `${(total / 1000).toFixed(1)}s 内只检测到 ${naps.length} 次打盹——多半又退回到用绝对时间算窗了`);
  assert.ok(naps[0] > tl.every + tl.show,
    `第一次打盹 ${naps[0]}ms 应晚于形变结束 ${tl.every + tl.show}ms（顺序：先变形，再睡）`);
  const gap = naps[1] - naps[0];
  assert.ok(Math.abs(gap - tl.total) < 600,
    `两次打盹间隔 ${gap}ms 应约等于周期 ${tl.total}ms`);

  ball.destroy();
});

/* 眼睛 g 直接取自闭眼线的 parent（rig 根节点每帧也带 translate，不能按特征捞 g）。
 * transform 是 translate(x y) rotate scale(sx sy)：translate 不受后续 scale 影响，
 * 所以两只眼 g 的 translate y 之差就是 dy 的实际效果。 */
function eyeGroups(host) {
  return walk(host)
    .filter((n) => n.tag === 'line' && n.attrs['stroke-width'] === '6.5')
    .map((n) => n.parent.parent);   /* line → inner(scale) → g(translate/rotate/scale) */
}

test('睡姿：右眼比左眼高（dy 生效）；睡醒：眼睛从压扁的线鼓成全开', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});

  /* 1) 睡姿 */
  ball.setEmotion('00');
  for (let i = 0; i < 120; i++) pump.step(16);   /* 2s，让插值收敛 */
  const gs = eyeGroups(host);
  assert.ok(gs.length === 2, `应找到两只眼睛的 g，实际 ${gs.length}`);
  const yOf = (g) => parseFloat(/translate\(-?[\d.]+ (-?[\d.]+)\)/.exec(g.attrs.transform)[1]);
  const yL = yOf(gs[0]), yR = yOf(gs[1]);
  assert.ok(yL - yR > 5 && yL - yR < 13,
    `右眼应比左眼高约 9px，实测差 ${(yL - yR).toFixed(1)}px`);

  /* 2) 睡醒膨胀：切回待机后，normal 眼形的纵向 scale 应先小于 0.7 再回到 1 */
  const normalRects = () => walk(host).filter((n) => n.tag === 'rect' && n.attrs.fill === '#FFF6DC'
    && /scale\(1 /.test(n.attrs.transform || ''));
  ball.setEmotion('01');
  let sawSquashed = false;
  let finalScale = 0;
  for (let i = 0; i < 150; i++) {
    pump.step(16);
    const scales = normalRects().map((n) => parseFloat(/scale\(1 ([\d.]+)\)/.exec(n.attrs.transform)[1]));
    if (scales.length && Math.min(...scales) < 0.7) sawSquashed = true;
    finalScale = scales.length ? scales[0] : finalScale;
  }
  assert.ok(sawSquashed, '睡醒过程中应出现压扁的胶囊（眼睛从线鼓开），却直接全开了');
  assert.ok(Math.abs(finalScale - 1) < 0.05, `醒稳后 scale 应回到 1，实际 ${finalScale.toFixed(3)}`);

  ball.destroy();
});
