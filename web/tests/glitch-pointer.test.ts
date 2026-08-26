import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeGlitchPointerVelocity,
  createGlitchPointerState,
  moveGlitchPointer,
  resetGlitchPointer,
} from "../components/chat/home/glitchPointer";

test("entering the canvas establishes a baseline without a velocity jump", () => {
  const pointer = createGlitchPointerState();

  moveGlitchPointer(pointer, 0.8, 0.4);

  assert.equal(pointer.active, true);
  assert.equal(pointer.vX, 0);
  assert.equal(pointer.vY, 0);
});

test("pointer velocity is an impulse consumed once per render frame", () => {
  const pointer = createGlitchPointerState();

  moveGlitchPointer(pointer, 0.5, 0.5);
  moveGlitchPointer(pointer, 0.6, 0.45);
  assert.ok(Math.abs(pointer.vX - 0.1) < 0.000001);
  assert.ok(Math.abs(pointer.vY + 0.05) < 0.000001);

  consumeGlitchPointerVelocity(pointer);
  assert.equal(pointer.vX, 0);
  assert.equal(pointer.vY, 0);
});

test("leaving or caching the page clears all pointer history", () => {
  const pointer = createGlitchPointerState();

  moveGlitchPointer(pointer, 0.5, 0.5);
  moveGlitchPointer(pointer, 0.65, 0.5);
  resetGlitchPointer(pointer);

  assert.deepEqual(pointer, createGlitchPointerState());
});
