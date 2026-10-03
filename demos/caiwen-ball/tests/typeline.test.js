import test from 'node:test';
import assert from 'node:assert/strict';
import { charDelay, prefersReducedMotion } from '../src/typeline.js';

test('未开变速度时，每个字符间隔就是基础速度', () => {
  for (let i = 0; i < 20; i++) {
    assert.equal(charDelay(55, undefined), 55);
    assert.equal(charDelay(55, null), 55);
  }
});

test('开了变速度，间隔落在 [min,max] 且真的会变（像人在打字）', () => {
  const v = { min: 40, max: 95 };
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const d = charDelay(55, v);
    assert.ok(d >= v.min && d <= v.max, `间隔 ${d} 越界`);
    seen.add(d);
  }
  assert.ok(seen.size > 100, `随机性不足，只出现了 ${seen.size} 种间隔`);
});

test('Node 环境（无 window）下 prefersReducedMotion 不崩且为 false', () => {
  assert.equal(prefersReducedMotion(), false);
});
