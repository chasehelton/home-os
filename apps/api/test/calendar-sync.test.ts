import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@home-os/db';
import { makeTestApp } from './_helpers.js';
import { syncAccount, type AccountRow, type SyncConfig } from '../src/calendar/sync.js';
import { makeTokenCrypto, deriveTokenKey } from '../src/auth/crypto.js';
import type { Env } from '../src/env.js';

// --- Fake Google endpoints ----------------------------------------------

interface Scenario {
  tokenResponses?: Array<{ status: number; body: unknown }>;
  calendarList?: { status: number; body: unknown };
  events?: Array<{ status: number; body: unknown }>;
}

function makeFetch(scenario: Scenario): typeof fetch {
  let tokenIdx = 0;
  let eventIdx = 0;
  return (async (input: URL | string | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      const r = scenario.tokenResponses?.[tokenIdx++] ?? {
        status: 200,
        body: { access_token: 'at', expires_in: 3600, scope: 'x' },
      };
      return new Response(JSON.stringify(r.body), { status: r.status });
    }
    if (url.includes('/calendar/v3/users/me/calendarList')) {
      const r = scenario.calendarList ?? { status: 200, body: { items: [] } };
      return new Response(JSON.stringify(r.body), { status: r.status });
    }
    if (url.includes('/calendar/v3/calendars/')) {
      const r = scenario.events?.[eventIdx++] ?? { status: 200, body: { items: [] } };
      return new Response(JSON.stringify(r.body), { status: r.status });
    }
    return new Response('not-mocked', { status: 500 });
  }) as unknown as typeof fetch;
}

async function seedAccount(ctx: Awaited<ReturnType<typeof makeTestApp>>) {
  const db = ctx.deps.db;
  // seed a user
  db.insert(schema.users)
    .values({
      id: 'u1',
      googleSub: 'sub-1',
      email: 'a@example.com',
      emailVerified: true,
      displayName: 'A',
    })
    .run();
  const crypto = makeTokenCrypto(deriveTokenKey(ctx.deps.env));
  db.insert(schema.calendarAccounts)
    .values({
      id: 'acc1',
      userId: 'u1',
      googleSub: 'sub-1',
      email: 'a@example.com',
      refreshTokenEnc: crypto.seal('refresh-1'),
      scopes: 'x',
      status: 'active',
    })
    .run();
  return db
    .select()
    .from(schema.calendarAccounts)
    .where(eq(schema.calendarAccounts.id, 'acc1'))
    .get() as AccountRow;
}

function cfgFor(env: Env, fetchImpl: typeof fetch): SyncConfig {
  return {
    clientId: 'cid',
    clientSecret: 'csec',
    crypto: makeTokenCrypto(deriveTokenKey(env)),
    fetchImpl,
  };
}

describe('calendar sync', () => {
  let ctx: Awaited<ReturnType<typeof makeTestApp>>;
  beforeEach(async () => {
    ctx = await makeTestApp();
    return async () => ctx.cleanup();
  });

  it('full sync populates calendar_lists and events', async () => {
    const account = await seedAccount(ctx);
    const f = makeFetch({
      calendarList: {
        status: 200,
        body: {
          items: [
            {
              id: 'cal1@group.calendar.google.com',
              summary: 'Primary',
              primary: true,
              selected: true,
              timeZone: 'America/Chicago',
            },
          ],
        },
      },
      events: [
        {
          status: 200,
          body: {
            items: [
              {
                id: 'ev1',
                status: 'confirmed',
                summary: 'Lunch',
                start: { dateTime: '2025-01-02T12:00:00-06:00', timeZone: 'America/Chicago' },
                end: { dateTime: '2025-01-02T13:00:00-06:00', timeZone: 'America/Chicago' },
                updated: '2025-01-01T00:00:00Z',
              },
              {
                id: 'ev2',
                status: 'confirmed',
                summary: 'Holiday',
                start: { date: '2025-01-05' },
                end: { date: '2025-01-06' },
                updated: '2025-01-01T00:00:00Z',
              },
            ],
            nextSyncToken: 'TOKEN-A',
          },
        },
      ],
    });
    const res = await syncAccount(ctx.deps.db, account, cfgFor(ctx.deps.env, f));
    expect(res.error).toBeUndefined();
    expect(res.upserted).toBe(2);
    expect(res.calendarsChecked).toBe(1);

    const events = ctx.deps.db.select().from(schema.calendarEvents).all();
    expect(events).toHaveLength(2);
    const allDay = events.find((e) => e.allDay);
    expect(allDay?.startDate).toBe('2025-01-05');
    expect(allDay?.endDateExclusive).toBe('2025-01-06');
    const timed = events.find((e) => !e.allDay);
    expect(timed?.startAt).toMatch(/^2025-01-02T18:00:00/);

    const list = ctx.deps.db.select().from(schema.calendarLists).get();
    expect(list?.syncToken).toBe('TOKEN-A');
    expect(list?.lastFullSyncAt).toBeTruthy();
  });

  it('incremental sync advances the syncToken and applies cancellations', async () => {
    const account = await seedAccount(ctx);
    const f1 = makeFetch({
      calendarList: {
        status: 200,
        body: { items: [{ id: 'cal1', summary: 'P', primary: true, selected: true }] },
      },
      events: [
        {
          status: 200,
          body: {
            items: [
              {
                id: 'ev1',
                status: 'confirmed',
                summary: 'Hello',
                start: { dateTime: '2025-02-01T10:00:00Z' },
                end: { dateTime: '2025-02-01T11:00:00Z' },
                updated: '2025-01-01T00:00:00Z',
              },
            ],
            nextSyncToken: 'T1',
          },
        },
      ],
    });
    await syncAccount(ctx.deps.db, account, cfgFor(ctx.deps.env, f1));
    expect(ctx.deps.db.select().from(schema.calendarEvents).all()).toHaveLength(1);

    const f2 = makeFetch({
      calendarList: {
        status: 200,
        body: { items: [{ id: 'cal1', summary: 'P', primary: true, selected: true }] },
      },
      events: [
        {
          status: 200,
          body: {
            items: [{ id: 'ev1', status: 'cancelled' }],
            nextSyncToken: 'T2',
          },
        },
      ],
    });
    const res2 = await syncAccount(ctx.deps.db, account, cfgFor(ctx.deps.env, f2));
    expect(res2.deleted).toBe(1);
    expect(ctx.deps.db.select().from(schema.calendarEvents).all()).toHaveLength(0);
    const list = ctx.deps.db.select().from(schema.calendarLists).get();
    expect(list?.syncToken).toBe('T2');
  });

  it('handles 410 by clearing syncToken for next full resync', async () => {
    const account = await seedAccount(ctx);
    // First run, establish syncToken
    const f1 = makeFetch({
      calendarList: {
        status: 200,
        body: { items: [{ id: 'cal1', summary: 'P', primary: true, selected: true }] },
      },
      events: [{ status: 200, body: { items: [], nextSyncToken: 'EXPIRED' } }],
    });
    await syncAccount(ctx.deps.db, account, cfgFor(ctx.deps.env, f1));
    expect(ctx.deps.db.select().from(schema.calendarLists).get()?.syncToken).toBe('EXPIRED');

    const f2 = makeFetch({
      calendarList: {
        status: 200,
        body: { items: [{ id: 'cal1', summary: 'P', primary: true, selected: true }] },
      },
      events: [{ status: 410, body: { error: { code: 410 } } }],
    });
    const r = await syncAccount(ctx.deps.db, account, cfgFor(ctx.deps.env, f2));
    expect(r.error).toBeUndefined();
    expect(ctx.deps.db.select().from(schema.calendarLists).get()?.syncToken).toBeNull();
  });

  it('disables the account on invalid_grant', async () => {
    const account = await seedAccount(ctx);
    const f = makeFetch({
      tokenResponses: [{ status: 400, body: { error: 'invalid_grant' } }],
    });
    const r = await syncAccount(ctx.deps.db, account, cfgFor(ctx.deps.env, f));
    expect(r.disabled).toBe(true);
    const reloaded = ctx.deps.db
      .select()
      .from(schema.calendarAccounts)
      .where(eq(schema.calendarAccounts.id, 'acc1'))
      .get();
    expect(reloaded?.status).toBe('disabled');
    expect(reloaded?.lastError).toBe('invalid_grant');
  });

  it('returns account_inactive for disabled accounts', async () => {
    const account = await seedAccount(ctx);
    ctx.deps.db
      .update(schema.calendarAccounts)
      .set({ status: 'disabled' })
      .where(eq(schema.calendarAccounts.id, 'acc1'))
      .run();
    const r = await syncAccount(
      ctx.deps.db,
      { ...account, status: 'disabled' },
      cfgFor(ctx.deps.env, makeFetch({})),
    );
    expect(r.error).toBe('account_inactive');
  });
});
