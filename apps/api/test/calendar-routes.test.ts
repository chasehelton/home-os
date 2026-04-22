import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeTestApp } from './_helpers.js';
import { createSession, SESSION_COOKIE } from '../src/auth/sessions.js';
import { schema } from '@home-os/db';
import { makeTokenCrypto, deriveTokenKey } from '../src/auth/crypto.js';

let ctx: Awaited<ReturnType<typeof makeTestApp>>;

beforeEach(async () => {
  ctx = await makeTestApp();
  const db = ctx.deps.db;
  // Two users to exercise cross-user isolation.
  db.insert(schema.users)
    .values([
      { id: 'u-a', email: 'a@example.com', emailVerified: true, displayName: 'A', googleSub: 'sub-a' },
      { id: 'u-b', email: 'b@example.com', emailVerified: true, displayName: 'B', googleSub: 'sub-b' },
    ])
    .run();
  const crypto = makeTokenCrypto(deriveTokenKey(ctx.deps.env));
  db.insert(schema.calendarAccounts)
    .values({
      id: 'acc-a',
      userId: 'u-a',
      googleSub: 'sub-a',
      email: 'a@example.com',
      refreshTokenEnc: crypto.seal('rt'),
      scopes: 'x',
      status: 'active',
    })
    .run();
  db.insert(schema.calendarLists)
    .values({
      id: 'list-a',
      accountId: 'acc-a',
      googleCalendarId: 'primary',
      summary: 'Primary',
      primary: true,
      selected: true,
    })
    .run();
  db.insert(schema.calendarEvents)
    .values([
      {
        id: 'ev-in',
        calendarListId: 'list-a',
        googleEventId: 'g1',
        title: 'In window',
        allDay: false,
        startAt: '2025-03-10T12:00:00.000Z',
        endAt: '2025-03-10T13:00:00.000Z',
        status: 'confirmed',
      },
      {
        id: 'ev-out',
        calendarListId: 'list-a',
        googleEventId: 'g2',
        title: 'Outside',
        allDay: false,
        startAt: '2025-04-10T12:00:00.000Z',
        endAt: '2025-04-10T13:00:00.000Z',
        status: 'confirmed',
      },
    ])
    .run();
});

afterEach(async () => {
  await ctx.cleanup();
});

function cookieFor(userId: string): string {
  const { id } = createSession(ctx.deps.db, { userId });
  const signed = (ctx.app as unknown as { signCookie: (v: string) => string }).signCookie(id);
  return `${SESSION_COOKIE}=${encodeURIComponent(signed)}`;
}

describe('calendar routes', () => {
  it('require auth', async () => {
    const r1 = await ctx.app.inject({ method: 'GET', url: '/api/calendar/accounts' });
    expect(r1.statusCode).toBe(401);
    const r2 = await ctx.app.inject({ method: 'GET', url: '/api/calendar/events?from=2025-01-01T00:00:00Z&to=2025-02-01T00:00:00Z' });
    expect(r2.statusCode).toBe(401);
  });

  it('GET /api/calendar/accounts returns the user own accounts with calendars', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/calendar/accounts',
      headers: { cookie: cookieFor('u-a') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].email).toBe('a@example.com');
    expect(body.accounts[0].calendars[0].googleCalendarId).toBe('primary');
  });

  it('GET /api/calendar/accounts isolates by user', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/calendar/accounts',
      headers: { cookie: cookieFor('u-b') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accounts).toHaveLength(0);
  });

  it('GET /api/calendar/events filters by window', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/calendar/events?from=2025-03-01&to=2025-03-31',
      headers: { cookie: cookieFor('u-a') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].title).toBe('In window');
  });

  it('GET /api/calendar/events rejects invalid window', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/calendar/events?from=bogus&to=also-bogus',
      headers: { cookie: cookieFor('u-a') },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/calendar/events does NOT leak another user events', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/calendar/events?from=2025-01-01&to=2025-12-31',
      headers: { cookie: cookieFor('u-b') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().events).toHaveLength(0);
  });

  it('DELETE /api/calendar/accounts/:id removes the account (cascade)', async () => {
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/calendar/accounts/acc-a',
      headers: { cookie: cookieFor('u-a') },
    });
    expect(res.statusCode).toBe(204);
    const remaining = ctx.deps.db.select().from(schema.calendarAccounts).all();
    expect(remaining).toHaveLength(0);
    // cascade
    expect(ctx.deps.db.select().from(schema.calendarEvents).all()).toHaveLength(0);
  });

  it('DELETE /api/calendar/accounts/:id returns 404 for other user accounts', async () => {
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/calendar/accounts/acc-a',
      headers: { cookie: cookieFor('u-b') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/calendar/sync requires auth but returns empty results when no accounts', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/calendar/sync',
      headers: { cookie: cookieFor('u-b') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toEqual([]);
  });
});
