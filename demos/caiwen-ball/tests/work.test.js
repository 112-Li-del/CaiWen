/* ============================================================
 * 工作态动作：思考的省略号（10）+ 检索的道具书（11）
 * ------------------------------------------------------------
 * 锁三件事：
 *   1. 思考进状态先缩成省略号：球整体缩到 20%（中间那颗点就是球自己）、
 *      左右各浮出一个旁点、影子淡出；点阶段结束全部还原。
 *   2. 检索时左下角有一本打开的书（渐显），且眼睛真的在沿书页左右扫——
 *      不同时刻眼睛的落点要不一样，不然"看书"就是摆拍。
 *   3. 切走后书要收起来。
 * ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { node, walk, installFakeDom } from './fakedom.js';

const STEPS = (pump, frames) => { for (let i = 0; i < frames; i++) pump.step(16); };

/** rig 组：刚体变换每帧都带 `translate(100 105) rotate(`（CX CY 是球心，写死在引擎里） */
const rigOf = (host) => walk(host).find((n) => n.tag === 'g' && /translate\(100 105\) rotate\(/.test(n.attrs.transform || ''));
/** 影子：cy=188 的 ellipse */
const shadowOf = (host) => walk(host).find((n) => n.tag === 'ellipse' && n.attrs.cy === '188');
/** 思考旁点：fill #8E1424 的 circle */
const sideDots = (host) => walk(host).filter((n) => n.tag === 'circle' && n.attrs.fill === '#8E1424');
/** 书组：transform 带 rotate(-5) 的 g */
const bookOf = (host) => walk(host).find((n) => n.tag === 'g' && (n.attrs.transform || '').includes('rotate(-5)'));
/** 左眼宿主 g：眼 rect(#FFF6DC) → inner(g) → eye.g(带 translate transform) */
const leftEyeG = (host) => {
  const r = walk(host).find((n) => n.tag === 'rect' && n.attrs.fill === '#FFF6DC');
  return r && r.parent && r.parent.parent;
};
const translateX = (g) => parseFloat((g.attrs.transform.match(/translate\(([-\d.]+)/) || [])[1]);

test('思考（10）：先缩成省略号——球缩到 20%、旁点亮起、影子淡出，之后还原', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('10');

  STEPS(pump, 75);                                    /* ≈1.2s，点阶段正中（dotsK=1） */
  const rigMid = rigOf(host).attrs.transform;
  const dotsMid = sideDots(host).map((c) => parseFloat(c.attrs.opacity));
  assert.ok(/scale\(0\.2\d*\)/.test(rigMid),
    `点阶段球应缩到 20%：${rigMid.slice(0, 80)}…`);
  assert.ok(dotsMid.length === 2 && Math.min(...dotsMid) > 0.15,
    `左右两个旁点应亮起：${JSON.stringify(dotsMid)}`);
  assert.ok(parseFloat(shadowOf(host).attrs.opacity) < 0.5,
    '点阶段影子应淡出（球已经不是"放在地上"的球了）');

  STEPS(pump, 300);                                   /* ≈6s，早已出点阶段 */
  assert.ok(!/scale\(0\./.test(rigOf(host).attrs.transform),
    '点阶段结束后球应恢复原尺寸');
  assert.ok(sideDots(host).every((c) => parseFloat(c.attrs.opacity) < 0.02),
    '旁点应熄灭');
  assert.equal(parseFloat(shadowOf(host).attrs.opacity), 1);

  ball.destroy();
});

test('检索（11）：左下角一本打开的书渐显，眼睛真的沿书页左右扫', async () => {
  const pump = installFakeDom();
  const { create } = await import('../src/engine.js');
  const host = node('div');
  const ball = create(host, {});
  ball.setEmotion('11');

  STEPS(pump, 120);                                   /* ≈2s，bookK 充分逼近 1 */
  const book = bookOf(host);
  assert.ok(book, '检索时应存在道具书（rotate(-8) 的组）');
  assert.ok(parseFloat(book.attrs.opacity) > 0.9, `书应渐显到位：${book.attrs.opacity}`);
  const pages = walk(book).filter((n) => n.tag === 'path' && n.attrs.stroke === '#73101F');
  assert.ok(pages.length >= 3, `书应有左右两页 + 中缝（现 ${pages.length} 条 path）`);
  /* 重做后的书：酒红硬皮封面（无描边的填色 path）+ 一张会翻的书页（嵌套 g） */
  const covers = walk(book).filter((n) => n.tag === 'path' && n.attrs.fill === '#73101F' && !n.attrs.stroke);
  assert.ok(covers.length >= 2, `应有左右两片酒红封面（现 ${covers.length}）`);
  const innerGroups = walk(book).filter((n) => n.tag === 'g');
  assert.ok(innerGroups.length >= 2, `应有内层组 + 翻页组（现 ${innerGroups.length} 个 g）`);
  /* 书要捧在身前（在球身之上）：bookG 应是 svg 的最后一个子节点 */
  const svg = book.parent;
  assert.equal(svg.children[svg.children.length - 1], book, '书应在最前景层（身前）');

  /* 眼睛在书上左右来回看：headYaw 是正弦摆，单点采样会撞上相位近似相等的位置
   * （实测两次只差 1.5px），所以在 2.5s 窗口里扫出落点范围。
   * 扫幅刻意收小（scanYaw 0.22→0.1）：扫大了球面透视会把靠边那只眼压窄 20%，
   * 两眼就不对称了（用户参考图是两只等大胶囊）。阈值从 12 降到 7。 */
  const xs = [];
  for (let i = 0; i < 156; i++) { pump.step(16); xs.push(translateX(leftEyeG(host))); }
  const span = Math.max(...xs) - Math.min(...xs);
  assert.ok(span > 7, `眼睛应左右扫视：2.5s 内落点范围只有 ${span.toFixed(1)}px，像在摆拍`);

  /* 切回待机，书要收起来 */
  ball.setEmotion('01');
  STEPS(pump, 200);                                   /* ≈3.2s，渐隐走完 */
  assert.ok(parseFloat(bookOf(host).attrs.opacity) < 0.05, '切走后书应渐隐收起');

  ball.destroy();
});
