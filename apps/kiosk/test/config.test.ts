import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('kiosk config', () => {
  it('provides sane defaults when no env is set', () => {
    const cfg = loadConfig({} as NodeJS.ProcessEnv);
    expect(cfg.url).toBe('http://localhost:5173');
    expect(cfg.healthUrl).toBe('http://localhost:3001/health/live');
    expect(cfg.diagnosticsUrl).toBe('http://localhost:5173');
    expect(cfg.kioskMode).toBe(true);
    expect(cfg.idleMs).toBe(5 * 60_000);
    expect(cfg.cleaningMs).toBe(30_000);
    expect(cfg.healthFailureThreshold).toBe(2);
  });

  it('respects overrides', () => {
    const cfg = loadConfig({
      HOME_OS_KIOSK_URL: 'https://home.ts.net',
      HOME_OS_KIOSK_HEALTH_URL: 'https://home.ts.net/api/health',
      HOME_OS_KIOSK_DIAGNOSTICS_URL: 'https://home.ts.net',
      HOME_OS_KIOSK_MODE: '0',
      HOME_OS_KIOSK_IDLE_MS: '60000',
      HOME_OS_KIOSK_CLEANING_MS: '5000',
      HOME_OS_KIOSK_HEALTH_INTERVAL_MS: '1000',
      HOME_OS_KIOSK_HEALTH_FAILURES: '5',
    } as NodeJS.ProcessEnv);
    expect(cfg.url).toBe('https://home.ts.net');
    expect(cfg.healthUrl).toBe('https://home.ts.net/api/health');
    expect(cfg.kioskMode).toBe(false);
    expect(cfg.idleMs).toBe(60_000);
    expect(cfg.cleaningMs).toBe(5_000);
    expect(cfg.healthIntervalMs).toBe(1_000);
    expect(cfg.healthFailureThreshold).toBe(5);
  });

  it('infers /health/live for the same origin when not in dev', () => {
    const cfg = loadConfig({
      HOME_OS_KIOSK_URL: 'https://home.example/app?foo=bar',
    } as NodeJS.ProcessEnv);
    expect(cfg.healthUrl).toBe('https://home.example/health/live');
  });

  it('rejects garbage numeric env values and falls back to defaults', () => {
    const cfg = loadConfig({
      HOME_OS_KIOSK_IDLE_MS: 'not-a-number',
      HOME_OS_KIOSK_HEALTH_FAILURES: '-1',
    } as NodeJS.ProcessEnv);
    expect(cfg.idleMs).toBe(5 * 60_000);
    expect(cfg.healthFailureThreshold).toBe(2);
  });

  it('leaves kioskToken null by default and reads HOME_OS_KIOSK_TOKEN', () => {
    expect(loadConfig({} as NodeJS.ProcessEnv).kioskToken).toBeNull();
    expect(loadConfig({ HOME_OS_KIOSK_TOKEN: '   ' } as NodeJS.ProcessEnv).kioskToken).toBeNull();
    expect(
      loadConfig({ HOME_OS_KIOSK_TOKEN: 'sekret' } as NodeJS.ProcessEnv).kioskToken,
    ).toBe('sekret');
  });
});
