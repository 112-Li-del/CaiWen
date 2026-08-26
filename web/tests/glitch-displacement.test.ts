import assert from "node:assert/strict";
import test from "node:test";

import {
  canvasBitmapMatchesTarget,
  decodeDisplacement,
  DISPLACEMENT_ZERO_BYTE,
  packDisplacement,
  resolveCanvasBitmapSize,
} from "../components/chat/home/glitchDisplacement";

test("packed glitch displacement preserves signed movement", () => {
  assert.equal(packDisplacement(0), DISPLACEMENT_ZERO_BYTE);
  assert.equal(decodeDisplacement(packDisplacement(0)), 0);
  assert.equal(decodeDisplacement(packDisplacement(22)), 22);
  assert.equal(decodeDisplacement(packDisplacement(-37)), -37);
});

test("packed glitch displacement clamps to the texture byte range", () => {
  assert.equal(packDisplacement(500), 255);
  assert.equal(packDisplacement(-500), 0);
});

test("a hidden cached route cannot replace the canvas with a 1px texture", () => {
  assert.equal(resolveCanvasBitmapSize(0, 0, 2), null);
  assert.equal(resolveCanvasBitmapSize(680, 144, 2)?.width, 1360);
  assert.equal(resolveCanvasBitmapSize(680, 144, 2)?.height, 288);
});

test("a recreated text texture is resized even when the visible canvas is reused", () => {
  const target = resolveCanvasBitmapSize(647.2, 144, 1.875);

  assert.ok(target);
  assert.equal(canvasBitmapMatchesTarget(1213, 270, target), true);
  assert.equal(canvasBitmapMatchesTarget(300, 150, target), false);
});
