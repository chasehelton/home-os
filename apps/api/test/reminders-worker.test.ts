import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp } from './_helpers.js';
import { schema } from '@home-os/db';
import { startReminderWorker } from '../src/reminders/worker.js';
import {
  upsertSubscription,
  type PushDispatcher,
  type PushSendResult,
  type PushPayload,
  type PushSubRow,
} from '../src/reminders/push.js';
import { createReminder } from '../src/reminders/repo.js';

let ctx: Awaited<ReturnType<typeof makeTestApp>>;

beforeEach(async () => {
  ctx = await makeTestApp();
  ctx.deps.db
    .insert(schema.users)
    .values([
      {
        id: 'u-jane',
        email: 'jane@example.com',
        emailVerified: true,
        displayName: 'Jane',
        googleSub: 'g1',
      },
      {
        id: 'u-john',
        email: 'john@example.com',
        emailVerified: true,
        displayName: 'John',
        googleSub: 'g2',
      },
    ])
    .run();
});
afterEach(async () => {
  await ctx.cleanup();
});

function makeDispatcher(behavior: (sub: PushSubRow) => PushSendResult): {
  dispatcher: PushDispatcher;
  calls: Array<{ sub: PushSubRow; payload: PushPayload }>;
} {
  const calls: Array<{ sub: PushSubRow; payload: PushPayload }> = [];
  const dispatcher: PushDispatcher = {
    enabled: true,
    async send(sub, payload) {
      calls.push({ sub, payload });
      return behavior(sub);
    },
  };
  return { dispatcher, calls };
}

describe('reminder worker', () => {
  it('fires a due user reminder in one tick and dispatches push to that user only', async () => {
    const janeSub = upsertSubscription(ctx.deps.db, 'u-jane', {
      endpoint: 'https://push.example.com/jane',
      p256dh: 'p',
      auth: 'a',
      userAgent: null,
    });
    upsertSubscription(ctx.deps.db, 'u-john', {
      endpoint: 'https://push.example.com/john',
      p256dh: 'p',
      auth: 'a',
      userAgent: null,
    });
    const r = createReminder(ctx.deps.db, 'u-jane', {
      scope: 'user',
      title: 'drink water',
      fireAt: '2000-01-01T00:00:00Z',
    });

    const { dispatcher, calls } = makeDispatcher(() => ({ ok: true, statusCode: 201 }));
    const w = startReminderWorker({
      db: ctx.deps.db,
      dispatcher,
      intervalMs: 1_000_000,
      now: () => new Date('2100-01-01T00:00:00Z'),
    });
    const fired = await w.tickNow();
    w.stop();

    expect(fired).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sub.endpoint).toBe(janeSub.endpoint);
    expect(calls[0]!.payload.id).toBe(r.id);

    const row = ctx.deps.db
      .select()
      .from(schema.reminders)
      .where(eq(schema.reminders.id, r.id))
      .get();
    expect(row?.status).toBe('fired');
    expect(row?.firedAt).toBeTruthy();
  });

  it('does not claim reminders whose fireAt is in the future', async () => {
    const r = createReminder(ctx.deps.db, 'u-jane', {
      scope: 'user',
      title: 'later',
      fireAt: '2100-06-01T00:00:00Z',
    });
    const { dispatcher, calls } = makeDispatcher(() => ({ ok: true }));
    const w = startReminderWorker({
      db: ctx.deps.db,
      dispatcher,
      intervalMs: 1_000_000,
      now: () => new Date('2100-01-01T00:00:00Z'),
    });
    expect(await w.tickNow()).toBe(0);
    w.stop();
    expect(calls).toHaveLength(0);
    const row = ctx.deps.db
      .select()
      .from(schema.reminders)
      .where(eq(schema.reminders.id, r.id))
      .get();
    expect(row?.status).toBe('pending');
  });

  it('concurrent ticks do not double-fire the same reminder', async () => {
    createReminder(ctx.deps.db, 'u-jane', {
      scope: 'household',
      title: 'dinner',
      fireAt: '2000-01-01T00:00:00Z',
    });
    const { dispatcher, calls } = makeDispatcher(() => ({ ok: true }));
    const w = startReminderWorker({
      db: ctx.deps.db,
      dispatcher,
      intervalMs: 1_000_000,
      now: () => new Date('2100-01-01T00:00:00Z'),
    });
    const [a, b] = await Promise.all([w.tickNow(), w.tickNow()]);
    w.stop();
    expect(a + b).toBe(1);
    // Household fan-out: 2 users, 0 subs => 0 calls here.
    expect(calls).toHaveLength(0);
  });

  it('permanent push failure (404/410) prunes the dead subscription', async () => {
    upsertSubscription(ctx.deps.db, 'u-jane', {
      endpoint: 'https://push.example.com/dead',
      p256dh: 'p',
      auth: 'a',
      userAgent: null,
    });
    createReminder(ctx.deps.db, 'u-jane', {
      scope: 'user',
      title: 'gone',
      fireAt: '2000-01-01T00:00:00Z',
    });
    const { dispatcher } = makeDispatcher(() => ({
      ok: false,
      statusCode: 410,
      removed: true,
      error: 'gone',
    }));
    const w = startReminderWorker({
      db: ctx.deps.db,
      dispatcher,
      intervalMs: 1_000_000,
      now: () => new Date('2100-01-01T00:00:00Z'),
    });
    await w.tickNow();
    w.stop();
    const subs = ctx.deps.db.select().from(schema.pushSubscriptions).all();
    expect(subs).toHaveLength(0);
  });

  it('transient push failure leaves the subscription intact and does not re-fire the reminder', async () => {
    upsertSubscription(ctx.deps.db, 'u-jane', {
      endpoint: 'https://push.example.com/alive',
      p256dh: 'p',
      auth: 'a',
      userAgent: null,
    });
    const r = createReminder(ctx.deps.db, 'u-jane', {
      scope: 'user',
      title: 'flaky',
      fireAt: '2000-01-01T00:00:00Z',
    });
    let calls = 0;
    const dispatcher: PushDispatcher = {
      enabled: true,
      async send() {
        calls++;
        return { ok: false, statusCode: 500, error: 'boom' };
      },
    };
    const w = startReminderWorker({
      db: ctx.deps.db,
      dispatcher,
      intervalMs: 1_000_000,
      now: () => new Date('2100-01-01T00:00:00Z'),
    });
    await w.tickNow();
    await w.tickNow();
    w.stop();
    expect(calls).toBe(1); // second tick finds no pending work
    expect(ctx.deps.db.select().from(schema.pushSubscriptions).all()).toHaveLength(1);
    const row = ctx.deps.db
      .select()
      .from(schema.reminders)
      .where(eq(schema.reminders.id, r.id))
      .get();
    expect(row?.status).toBe('fired');
  });

  it('household reminder fans out to all users’ subscriptions', async () => {
    upsertSubscription(ctx.deps.db, 'u-jane', {
      endpoint: 'https://push.example.com/jane',
      p256dh: 'p',
      auth: 'a',
      userAgent: null,
    });
    upsertSubscription(ctx.deps.db, 'u-john', {
      endpoint: 'https://push.example.com/john',
      p256dh: 'p',
      auth: 'a',
      userAgent: null,
    });
    createReminder(ctx.deps.db, 'u-jane', {
      scope: 'household',
      title: 'family',
      fireAt: '2000-01-01T00:00:00Z',
    });
    const { dispatcher, calls } = makeDispatcher(() => ({ ok: true }));
    const w = startReminderWorker({
      db: ctx.deps.db,
      dispatcher,
      intervalMs: 1_000_000,
      now: () => new Date('2100-01-01T00:00:00Z'),
    });
    await w.tickNow();
    w.stop();
    const endpoints = calls.map((c) => c.sub.endpoint).sort();
    expect(endpoints).toEqual([
      'https://push.example.com/jane',
      'https://push.example.com/john',
    ]);
  });
});
