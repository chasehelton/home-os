// Pure idle-dim logic. No DOM, no Electron — so it unit-tests cleanly.

export interface IdleState {
  lastActivityAt: number;
  dimmed: boolean;
}

export function initialIdleState(now: number): IdleState {
  return { lastActivityAt: now, dimmed: false };
}

export function onActivity(state: IdleState, now: number): IdleState {
  // Any activity resets the timer and undims.
  return { lastActivityAt: now, dimmed: false };
}

export function tickIdle(
  state: IdleState,
  now: number,
  thresholdMs: number
): IdleState {
  const idleFor = now - state.lastActivityAt;
  const shouldDim = idleFor >= thresholdMs;
  if (shouldDim === state.dimmed) return state;
  return { ...state, dimmed: shouldDim };
}
