/* 用 Node 内置测试跑： node --test            （无需安装任何依赖） */
import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp, lerp, easings, spring, springStep, approach, smoothClosedPath,
  loopNoise, blinkOpenMul, smoothstep, pulseAmount, TAU } from '../src/math.js';

test('clamp / lerp 边界正确', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-5, 0, 3), 0);
  assert.equal(lerp(0, 10, 0.5), 5);
});

test('缓动函数在端点恒为 0 和 1', () => {
  for (const [name, fn] of Object.entries(easings)) {
    assert.ok(Math.abs(fn(0)) < 1e-6, `${name}(0) 应为 0`);
    assert.ok(Math.abs(fn(1) - 1) < 1e-6, `${name}(1) 应为 1`);
  }
});

test('approach 帧率无关：一大步 ≈ 两小步', () => {
  const once = approach(0, 10, 6, 0.2);
  const twice = approach(approach(0, 10, 6, 0.1), 10, 6, 0.1);
  assert.ok(Math.abs(once - twice) < 1e-9, `一次 0.2s 与两次 0.1s 结果应一致：${once} vs ${twice}`);
});

test('approach 单调且不会越过目标', () => {
  let v = 0;
  for (let i = 0; i < 100; i++) {
    const next = approach(v, 10, 8, 0.016);
    assert.ok(next >= v && next <= 10);
    v = next;
  }
  assert.ok(v > 9.9, '收敛后应非常接近目标');
});

test('弹簧收敛到目标且不发散', () => {
  const s = spring(0);
  s.t = 10;
  for (let i = 0; i < 600; i++) springStep(s, 12, 1, 1 / 60);
  assert.ok(Math.abs(s.x - 10) < 1e-6, `应稳定在目标值，实际 ${s.x}`);
  assert.ok(Number.isFinite(s.v));
});

test('弹簧在超大 dt 下不会炸', () => {
  const s = spring(0);
  s.t = 100;
  const x = springStep(s, 20, 0.9, 2);
  assert.ok(Number.isFinite(x), 'dt=2s 也必须保持有限值');
});

test('smoothClosedPath 输出合法且不产生 NaN', () => {
  const pts = [];
  for (let i = 0; i < 8; i++) pts.push([Math.cos((i / 8) * TAU) * 50, Math.sin((i / 8) * TAU) * 50]);
  const d = smoothClosedPath(pts);
  assert.ok(d.startsWith('M '));
  assert.ok(d.trim().endsWith('Z'));
  assert.ok(!d.includes('NaN'));
});

/* ---------------- 活人感：游移噪声与眨眼 ---------------- */

test('loopNoise 取值恒在 [-1,1] 且不恒定', () => {
  const periods = [11.3, 3.7, 9.1];
  let min = 1, max = -1;
  for (let t = 0; t < 200; t += 0.13) {
    const v = loopNoise(t, periods);
    assert.ok(Number.isFinite(v) && v >= -1 && v <= 1, `越界：${v}`);
    min = Math.min(min, v); max = Math.max(max, v);
  }
  assert.ok(max - min > 1, '多周期叠加应覆盖较大范围，否则游移看不出来');
});

test('loopNoise 空周期表返回 0，周期表为空数组也不炸', () => {
  assert.equal(loopNoise(3, []), 0);
  assert.equal(loopNoise(3, null), 0);
});

test('blinkOpenMul：单眨 t=0/1 睁、t=0.5 闭', () => {
  assert.ok(Math.abs(blinkOpenMul(0, 1) - 1) < 1e-9);
  assert.ok(Math.abs(blinkOpenMul(0.5, 1)) < 1e-9, '单眨中点必须全闭');
  assert.ok(Math.abs(blinkOpenMul(1, 1) - 1) < 1e-9);
});

test('blinkOpenMul：双眨在中点重新睁开、四分之一处全闭两次', () => {
  assert.ok(Math.abs(blinkOpenMul(0.25, 2)) < 1e-9, '第一下应全闭');
  assert.ok(Math.abs(blinkOpenMul(0.5, 2) - 1) < 1e-9, '中点应重新睁开');
  assert.ok(Math.abs(blinkOpenMul(0.75, 2)) < 1e-9, '第二下应全闭');
  assert.ok(Math.abs(blinkOpenMul(1, 2) - 1) < 1e-9, '结尾必须回到睁眼');
});

test('smoothstep 端点恒 0/1、中点 0.5', () => {
  assert.equal(smoothstep(0), 0);
  assert.equal(smoothstep(1), 1);
  assert.ok(Math.abs(smoothstep(0.5) - 0.5) < 1e-9);
  assert.equal(smoothstep(-3), 0, '超出下界应被夹住');
  assert.equal(smoothstep(9), 1, '超出上界应被夹住');
});

/* 打盹用的梯形窗：[1.5, 3.5] 满值，两端 0.35s 缓入缓出 */
test('pulseAmount：窗内为 1、窗外为 0、斜坡单调', () => {
  const f = (t) => pulseAmount(t, 1.5, 3.5, 0.35);
  assert.equal(f(0), 0, '窗前应为 0');
  assert.equal(f(1.0), 0, '缓入开始前应为 0');
  assert.equal(f(2.5), 1, '窗内应为 1');
  assert.equal(f(4.0), 0, '窗后应为 0');
  assert.ok(f(1.3) > 0 && f(1.3) < 1, '缓入段应在 0~1 之间');
  assert.ok(f(3.7) > 0 && f(3.7) < 1, '缓出段应在 0~1 之间');
  let prev = 0;
  for (let t = 1.15; t <= 1.5; t += 0.01) { const v = f(t); assert.ok(v >= prev - 1e-12, '缓入必须单调不减'); prev = v; }
  prev = 1;
  for (let t = 3.5; t <= 3.85; t += 0.01) { const v = f(t); assert.ok(v <= prev + 1e-12, '缓出必须单调不增'); prev = v; }
});

test('pulseAmount：退化与越界输入都返回 0，不产生 NaN', () => {
  assert.equal(pulseAmount(1, 3, 1, 0.35), 0, 'end <= start 视为无效窗');
  assert.equal(pulseAmount(NaN, 1, 2, 0.35), 0, 'NaN 输入应被拒绝而不是传染进每帧循环');
  /* fade 大于半窗时会被夹到半窗，仍需能取到 1 */
  assert.equal(pulseAmount(1.5, 1.0, 2.0, 5), 1, 'fade 被夹后窗内仍应为 1');
});
