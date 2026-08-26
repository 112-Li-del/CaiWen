export type GlitchPointerState = {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vX: number;
  vY: number;
  active: boolean;
};

export function createGlitchPointerState(): GlitchPointerState {
  return {
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    vX: 0,
    vY: 0,
    active: false,
  };
}

export function moveGlitchPointer(
  state: GlitchPointerState,
  x: number,
  y: number,
) {
  if (!state.active) {
    state.x = x;
    state.y = y;
    state.prevX = x;
    state.prevY = y;
    state.vX = 0;
    state.vY = 0;
    state.active = true;
    return;
  }

  state.vX += x - state.prevX;
  state.vY += y - state.prevY;
  state.prevX = x;
  state.prevY = y;
  state.x = x;
  state.y = y;
}

export function consumeGlitchPointerVelocity(state: GlitchPointerState) {
  state.vX = 0;
  state.vY = 0;
}

export function resetGlitchPointer(state: GlitchPointerState) {
  state.x = 0;
  state.y = 0;
  state.prevX = 0;
  state.prevY = 0;
  state.vX = 0;
  state.vY = 0;
  state.active = false;
}
