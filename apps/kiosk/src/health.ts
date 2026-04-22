// Pure health-watcher logic. The Electron main process wires this to a
// real fetch + setInterval loop.

export interface HealthState {
  consecutiveFailures: number;
  offline: boolean;
  nextDelayMs: number;
}

export interface HealthConfig {
  baseIntervalMs: number;
  failureThreshold: number;
  maxDelayMs?: number;
}

export function initialHealthState(cfg: HealthConfig): HealthState {
  return {
    consecutiveFailures: 0,
    offline: false,
    nextDelayMs: cfg.baseIntervalMs,
  };
}

export function onHealthResult(
  state: HealthState,
  ok: boolean,
  cfg: HealthConfig
): HealthState {
  if (ok) {
    return {
      consecutiveFailures: 0,
      offline: false,
      nextDelayMs: cfg.baseIntervalMs,
    };
  }
  const failures = state.consecutiveFailures + 1;
  const offline = failures >= cfg.failureThreshold;
  // Exponential backoff capped at maxDelayMs (default 2 min).
  const cap = cfg.maxDelayMs ?? 2 * 60_000;
  const delay = Math.min(cfg.baseIntervalMs * 2 ** (failures - 1), cap);
  return { consecutiveFailures: failures, offline, nextDelayMs: delay };
}
