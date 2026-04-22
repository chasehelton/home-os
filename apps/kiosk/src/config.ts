export interface KioskConfig {
  url: string;
  healthUrl: string;
  diagnosticsUrl: string;
  kioskMode: boolean;
  idleMs: number;
  cleaningMs: number;
  healthIntervalMs: number;
  healthFailureThreshold: number;
}

function pickInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): KioskConfig {
  const url = env.HOME_OS_KIOSK_URL ?? 'http://localhost:5173';
  // By default probe api on same host, different port. In real deploy this
  // will be same-origin behind Caddy; both get overridden via env.
  const healthUrl =
    env.HOME_OS_KIOSK_HEALTH_URL ?? inferHealthUrl(url);
  // URL rendered in the QR code on the crash screen. Defaults to the
  // kiosk URL but on a Pi this should be the tailnet hostname so a phone
  // on the same tailnet can actually reach it.
  const diagnosticsUrl = env.HOME_OS_KIOSK_DIAGNOSTICS_URL ?? url;
  const kioskMode = env.HOME_OS_KIOSK_MODE !== '0';
  return {
    url,
    healthUrl,
    diagnosticsUrl,
    kioskMode,
    idleMs: pickInt(env.HOME_OS_KIOSK_IDLE_MS, 5 * 60 * 1000),
    cleaningMs: pickInt(env.HOME_OS_KIOSK_CLEANING_MS, 30 * 1000),
    healthIntervalMs: pickInt(env.HOME_OS_KIOSK_HEALTH_INTERVAL_MS, 15_000),
    healthFailureThreshold: pickInt(env.HOME_OS_KIOSK_HEALTH_FAILURES, 2),
  };
}

function inferHealthUrl(webUrl: string): string {
  try {
    const u = new URL(webUrl);
    // Dev: web on :5173, api on :3001.
    if (u.port === '5173') {
      u.port = '3001';
      u.pathname = '/health/live';
      return u.toString();
    }
    u.pathname = '/health/live';
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return 'http://localhost:3001/health/live';
  }
}
