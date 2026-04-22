import { describe, it, expect } from 'vitest';
import { initialHealthState, onHealthResult } from '../src/health.js';

const cfg = { baseIntervalMs: 1000, failureThreshold: 2, maxDelayMs: 60_000 };

describe('kiosk health', () => {
  it('starts online with base interval', () => {
    const s = initialHealthState(cfg);
    expect(s.consecutiveFailures).toBe(0);
    expect(s.offline).toBe(false);
    expect(s.nextDelayMs).toBe(1000);
  });

  it('goes offline after threshold consecutive failures', () => {
    let s = initialHealthState(cfg);
    s = onHealthResult(s, false, cfg);
    expect(s.consecutiveFailures).toBe(1);
    expect(s.offline).toBe(false);
    s = onHealthResult(s, false, cfg);
    expect(s.consecutiveFailures).toBe(2);
    expect(s.offline).toBe(true);
  });

  it('resets on success', () => {
    let s = initialHealthState(cfg);
    s = onHealthResult(s, false, cfg);
    s = onHealthResult(s, false, cfg);
    expect(s.offline).toBe(true);
    s = onHealthResult(s, true, cfg);
    expect(s.offline).toBe(false);
    expect(s.consecutiveFailures).toBe(0);
    expect(s.nextDelayMs).toBe(1000);
  });

  it('uses exponential backoff capped at maxDelayMs', () => {
    let s = initialHealthState(cfg);
    s = onHealthResult(s, false, cfg);
    expect(s.nextDelayMs).toBe(1000);
    s = onHealthResult(s, false, cfg);
    expect(s.nextDelayMs).toBe(2000);
    s = onHealthResult(s, false, cfg);
    expect(s.nextDelayMs).toBe(4000);
    for (let i = 0; i < 20; i += 1) s = onHealthResult(s, false, cfg);
    expect(s.nextDelayMs).toBeLessThanOrEqual(cfg.maxDelayMs!);
  });
});
