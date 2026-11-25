import assert from 'node:assert/strict';
import test from 'node:test';
import { installFakeDom, node, walk } from '../../demos/caiwen-ball/tests/fakedom.js';
import { create } from '../lib/emotion-ball/engine.js';

test('idle morph keeps its outline at a segment boundary and eases out on thinking', () => {
  const clock = installFakeDom();
  const host = node('div');
  const ball = create(host, { gaze: false });
  try {
    ball.setEmotion('01');
    const body = walk(host).find((el) => el.attrs.class === 'cw-hit');
    const firstX = () => Number(body.attrs.d.match(/^M\s*([-\d.]+)/)[1]);
    clock.step(10000);
    clock.step(6449);
    const before = firstX();
    clock.step(1);
    assert.ok(Math.abs(firstX() - before) < 1);
    ball.setEmotion('10');
    clock.step(16);
    assert.ok(Math.abs(firstX() - before) < 4);
  } finally {
    ball.destroy();
  }
});

test('a touch-like click rebounds away from the contact point and a drag is ignored', () => {
  const clock = installFakeDom();
  const host = node('div');
  let pokes = 0;
  const ball = create(host, { onPoke: () => pokes++ });
  try {
    const svg = host.children[0];
    const body = walk(host).find((el) => el.attrs.class === 'cw-hit');
    const x = () => Number(body.parent.parent.attrs.transform.match(/^translate\(([-\d.]+)/)[1]);
    const left = { clientX: 55, clientY: 105, pointerType: 'touch' };
    svg.dispatch('pointerdown', left);
    svg.dispatch('pointermove', { ...left, clientX: 70 });
    svg.dispatch('click', left);
    assert.equal(pokes, 0);
    svg.dispatch('pointerdown', left);
    svg.dispatch('click', left);
    clock.step(16);
    const first = x();
    assert.ok(first > 0);
    svg.dispatch('pointerdown', left);
    svg.dispatch('click', left);
    clock.step(16);
    assert.ok(x() > first);
    assert.equal(pokes, 2);
    for (let i = 0; i < 80; i++) clock.step(16);
    assert.ok(Math.abs(x()) < 0.1);
  } finally {
    ball.destroy();
  }
});

test('scene lines vary and working states replace poke feedback', () => {
  const clock = installFakeDom();
  window.matchMedia = () => ({ matches: true });
  const host = node('div');
  const tip = Object.assign(new Element(), node('div'));
  const ball = create(host, { tip });
  try {
    const read = () => tip.children[0].textContent;
    for (const scene of ['02', '20']) {
      ball.setEmotion(scene);
      const first = read();
      ball.setEmotion('01');
      ball.setEmotion(scene);
      assert.ok(first);
      assert.notEqual(read(), first);
    }
    ball.setEmotion('01');
    clock.step(16);
    ball.poke();
    const first = read();
    clock.step(2001);
    ball.poke();
    assert.notEqual(read(), first);
    ball.setEmotion('10');
    assert.equal(read(), '让我想想~');
  } finally {
    ball.destroy();
  }
});

test('only three pokes within the window spin the ball for one turn', () => {
  const clock = installFakeDom();
  const host = node('div');
  const reference = node('div');
  const ball = create(host, { gaze: false });
  const still = create(reference, { gaze: false });
  const meridian = (root) => walk(root).find((el) => el.attrs['stroke-width'] === '1.8').attrs.rx;
  const samePhase = () => assert.equal(meridian(host), meridian(reference));
  try {
    clock.step(16);
    ball.poke();
    clock.step(701);
    ball.poke();
    clock.step(100);
    ball.poke();
    clock.step(100);
    samePhase();
    ball.poke();
    clock.step(350);
    assert.notEqual(meridian(host), meridian(reference));
    ball.poke();
    ball.poke();
    ball.poke();
    clock.step(700);
    samePhase();
  } finally {
    ball.destroy();
    still.destroy();
  }
});
