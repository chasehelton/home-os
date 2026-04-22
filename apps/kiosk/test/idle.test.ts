import { describe, it, expect } from 'vitest';
import { initialIdleState, onActivity, tickIdle } from '../src/idle.js';

describe('kiosk idle', () => {
  it('starts undimmed', () => {
    const s = initialIdleState(1000);
    expect(s.dimmed).toBe(false);
    expect(s.lastActivityAt).toBe(1000);
  });

  it('tickIdle dims after threshold', () => {
    const s0 = initialIdleState(0);
    const s1 = tickIdle(s0, 4_000, 5_000);
    expect(s1.dimmed).toBe(false);
    const s2 = tickIdle(s1, 6_000, 5_000);
    expect(s2.dimmed).toBe(true);
  });

  it('activity resets the timer and undims', () => {
    const s0 = initialIdleState(0);
    const dimmed = tickIdle(s0, 10_000, 5_000);
    expect(dimmed.dimmed).toBe(true);
    const resumed = onActivity(dimmed, 11_000);
    expect(resumed.dimmed).toBe(false);
    expect(resumed.lastActivityAt).toBe(11_000);
  });

  it('tickIdle is a no-op when the state would not change (referential stability)', () => {
    const s0 = initialIdleState(0);
    const s1 = tickIdle(s0, 1_000, 5_000);
    expect(s1).toBe(s0);
  });
});
