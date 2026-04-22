import type { DB } from '@home-os/db';
import {
  claimDueReminders,
  targetUserIdsForReminder,
  type ReminderRow,
} from './repo.js';
import {
  deleteSubscriptionByEndpoint,
  listSubscriptionsForUsers,
  type PushDispatcher,
} from './push.js';

export interface StartReminderWorkerOptions {
  db: DB;
  dispatcher: PushDispatcher;
  intervalMs: number;
  /** override clock for tests (defaults to real time). */
  now?: () => Date;
  logger?: {
    info: (msg: string, obj?: unknown) => void;
    warn: (msg: string, obj?: unknown) => void;
  };
}

export interface ReminderWorker {
  stop(): void;
  tickNow(): Promise<number>;
}

/**
 * Periodic reminder-firing loop. Atomically claims due reminders and
 * best-effort dispatches Web Push to every subscription of every target
 * user. Push is lossy under crashes by design; banner polling is the
 * reliable delivery channel.
 */
export function startReminderWorker(opts: StartReminderWorkerOptions): ReminderWorker {
  let running = false;
  let stopped = false;
  const now = opts.now ?? (() => new Date());
  const log = opts.logger ?? { info: () => {}, warn: () => {} };

  const dispatch = async (reminder: ReminderRow) => {
    const userIds = targetUserIdsForReminder(opts.db, reminder);
    const subs = listSubscriptionsForUsers(opts.db, userIds);
    if (subs.length === 0) return;
    await Promise.all(
      subs.map(async (sub) => {
        const res = await opts.dispatcher.send(sub, {
          id: reminder.id,
          title: reminder.title,
          body: reminder.body,
          entityType: reminder.entityType,
          entityId: reminder.entityId,
        });
        if (!res.ok && res.removed) {
          deleteSubscriptionByEndpoint(opts.db, sub.endpoint);
          log.info('reminder push: pruned dead subscription', {
            endpoint: redactEndpoint(sub.endpoint),
            statusCode: res.statusCode,
          });
        } else if (!res.ok) {
          log.warn('reminder push: transient failure', {
            endpoint: redactEndpoint(sub.endpoint),
            statusCode: res.statusCode,
            error: res.error,
          });
        }
      }),
    );
  };

  const tick = async (): Promise<number> => {
    if (running || stopped) return 0;
    running = true;
    try {
      const claimed = claimDueReminders(opts.db, now().toISOString());
      if (claimed.length === 0) return 0;
      for (const reminder of claimed) {
        try {
          await dispatch(reminder);
        } catch (err) {
          log.warn('reminder dispatch failed', { id: reminder.id, err });
        }
      }
      return claimed.length;
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, opts.intervalMs);
  if (typeof handle.unref === 'function') handle.unref();

  // Kick a first tick shortly after boot.
  const first = setTimeout(() => {
    void tick();
  }, 500);
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

// Don't leak the per-user push endpoint URL into logs.
function redactEndpoint(endpoint: string): string {
  try {
    const u = new URL(endpoint);
    return `${u.protocol}//${u.host}/…`;
  } catch {
    return '…';
  }
}
