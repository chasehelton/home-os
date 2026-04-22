import { eq } from 'drizzle-orm';
import type { DB } from '@home-os/db';
import { schema } from '@home-os/db';
import { syncAccount, withAccountLock, type AccountRow, type SyncConfig } from './sync.js';

export interface StartWorkerOptions {
  db: DB;
  cfg: SyncConfig;
  intervalMs: number;
  logger?: { info: (msg: string, obj?: unknown) => void; warn: (msg: string, obj?: unknown) => void };
}

export interface CalendarWorker {
  stop(): void;
  tickNow(): Promise<void>;
}

/**
 * Periodic sync loop. Iterates all active calendar_accounts and syncs each
 * under its per-account lock (so overlapping ticks + a user-triggered sync
 * serialize cleanly). Exceptions are never thrown out of the tick.
 */
export function startCalendarWorker(opts: StartWorkerOptions): CalendarWorker {
  let running = false;
  let stopped = false;
  const log = opts.logger ?? { info: () => {}, warn: () => {} };

  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const accounts = opts.db
        .select()
        .from(schema.calendarAccounts)
        .where(eq(schema.calendarAccounts.status, 'active'))
        .all() as AccountRow[];
      for (const a of accounts) {
        if (stopped) break;
        try {
          await withAccountLock(a.id, () => syncAccount(opts.db, a, opts.cfg));
        } catch (err) {
          log.warn('calendar sync tick failed', { accountId: a.id, err });
        }
      }
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, opts.intervalMs);
  // Don't let the worker keep the event loop alive during shutdown.
  if (typeof handle.unref === 'function') handle.unref();

  // Kick off a first tick shortly after boot (but let the server finish
  // starting first).
  const first = setTimeout(() => {
    void tick();
  }, 1000);
  if (typeof first.unref === 'function') first.unref();

  return {
    stop() {
      stopped = true;
      clearInterval(handle);
      clearTimeout(first);
    },
    tickNow: tick,
  };
}
