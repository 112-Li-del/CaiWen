/* ============================================================
 * 点球转身 + 流星彩带：时序与生命周期测试
 * ------------------------------------------------------------
 * 锁四件事：
 *   1. poke 后球是"转身"（yaw 绕竖直轴）而不是 rig 的 2D 平面旋转：
 *      rig rotate 恒 0；转身中段眼睛绕到背面（opacity=0）；经线转整圈后
 *      rx 与起点重合（2π≡0，无相位残留）。
 *   2. 彩带是渐变流星：3 条轨道各有专属 linearGradient + 分段拖尾 path；
 *      寿命尽头 path/gradient/流星头全部清理干净；连点重开不残留。
 *   3. 点击命中判定：球内触发、球外不触发。
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

function meridianRxs(host) {
  return walk(host)
    .filter((n) => n.tag === 'ellipse' && n.attrs.stroke === 'rgba(255,246,220,.55)')
    .map((n) => parseFloat(n.attrs.rx));
}

/** 眼睛 g：待机 normal 眼 rect(fill CREAM) 的 parent.parent（rect→inner→g） */
function eyeGs(host) {
  return walk(host)
    .filter((n) => n.tag === 'rect' && n.attrs.fill === '#FFF6DC')
    .map((n) => n.parent.parent);
}

const ribbonGrads = (host) => walk(host).filter((n) => n.tag === 'linearGradient' && /cw-rbn-/.test(n.attrs.id || ''));
const ribbonSegs = (host) => walk(host).filter((n) => n.tag === 'path' && /^url\(#cw-rbn-/.test(n.attrs.stroke || ''));

test('poke 后是转身不是平面旋转：rig rotate 恒 0、眼睛绕到背面、经线转整圈归位', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  for (let i = 0; i < 60; i++) pump.step(16);   /* 先稳定跑 1s，取经线基线 */

  const rig = rigOf(host);
  const baseline = meridianRxs(host);
  assert.equal(baseline.length, 4, '应有 4 条经线');

  ball.poke();

  let sawHidden = false;
  /* 泵 65 帧（a=1.04s，转身还差半帧结束）：此时 spinYaw 已达 2π-ε 且经线相位
   * 仍被 twirl 精确覆盖（phase0+spinYaw），归位差只剩浮点残差。
   * 泵过 66 帧 twirl 就清掉了，自然自转（0.55rad/s）会继续走，"归位"变"又转过一截"。 */
  for (let i = 0; i < 65; i++) {
    pump.step(16);
    assert.ok(Math.abs(rotateOf(rig)) < 1, `rig 不应做 2D 平面旋转（转身是 yaw 层的球面旋转），实测 ${rotateOf(rig)}`);
    const ops = eyeGs(host).map((g) => parseFloat(g.attrs.opacity));
    if (ops.length && Math.min(...ops) < 0.05) sawHidden = true;
  }
  assert.ok(sawHidden, '转身过程中眼睛应绕到球背面而消失（展示"背"的那一段）');

  /* 经线转了整圈：2π≡0，结束时 rx 必须与起点重合，否则转身没转准一圈 */
  const rxs = meridianRxs(host);
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(rxs[i] - baseline[i]) < 0.6,
      `经线 ${i} 转身结束应归位：起点 ${baseline[i].toFixed(1)} 结束 ${rxs[i].toFixed(1)}`);
  }

  ball.destroy();
});

test('流星彩带：3 条渐变轨道 × 16 段拖尾（每段都在画），寿命尽头全部清理；连点重开不残留', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  pump.step(16); pump.step(16);

  ball.poke();
  assert.ok(ribbonGrads(host).length === 3, `应有 3 个彩带渐变，实际 ${ribbonGrads(host).length}`);
  assert.ok(ribbonSegs(host).length === 48,
    `3 轨道 × (背8+前8) 段拖尾 = 48 条 path，实际 ${ribbonSegs(host).length}`);

  /* 拖尾消失 bug 的回归锁：SVG 里以 lineto 开头、没有 moveto 的 path 是非法的，
   * 浏览器整段不渲染——当时除第一段外全部以 'L' 起头，画面上就只剩流星头那颗点。
   * 所以每段（只要真的有几何）必须以 M 开头。 */
  for (let f = 0; f < 25; f++) {
    pump.step(16);
    const drawn = ribbonSegs(host).filter((p) => (p.attrs.d || '').length > 0);
    assert.ok(drawn.length > 0, '应有拖尾在绘制');
    for (const p of drawn) {
      assert.ok(p.attrs.d.trimStart().startsWith('M'),
        `拖尾每段必须自带 moveto，实际以 "${p.attrs.d.slice(0, 6)}" 开头——该段在浏览器里不会被渲染`);
    }
  }

  for (let i = 0; i < 20; i++) pump.step(16);
  ball.poke();
  assert.ok(ribbonGrads(host).length === 3 && ribbonSegs(host).length === 48,
    '连点应重开而不是叠加');

  for (let i = 0; i < 130; i++) pump.step(16);   /* 2.08s > 寿命 1.8s */
  assert.ok(ribbonGrads(host).length === 0 && ribbonSegs(host).length === 0,
    `彩带寿命尽头应清理干净：grad=${ribbonGrads(host).length} segs=${ribbonSegs(host).length}`);

  ball.destroy();
});

test('点击命中：球内触发流星转身，球外不触发', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  pump.step(16); pump.step(16);

  const svg = host.children[0];
  assert.equal(svg.tag, 'svg', 'engine 应把 svg 插在容器最前');

  /* 球外：viewBox 左上角，距球心远超 1.22R */
  svg.dispatch('click', { clientX: 2, clientY: 2 });
  for (let i = 0; i < 10; i++) pump.step(16);
  assert.ok(ribbonGrads(host).length === 0, '点球外不应生成彩带');

  /* 球内：正中 */
  svg.dispatch('click', { clientX: 100, clientY: 105 });
  let sawRibbon = false;
  for (let i = 0; i < 10; i++) {
    pump.step(16);
    if (ribbonGrads(host).length === 3) { sawRibbon = true; break; }
  }
  assert.ok(sawRibbon, '点球内应生成流星彩带（并进入转身）');

  ball.destroy();
});
