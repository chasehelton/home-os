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
      {
        id: 'u-a',
        email: 'a@example.com',
        emailVerified: true,
        displayName: 'A',
        googleSub: 'sub-a',
      },
      {
        id: 'u-b',
        email: 'b@example.com',
        emailVerified: true,
        displayName: 'B',
        googleSub: 'sub-b',
      },
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
    const r2 = await ctx.app.inject({
      method: 'GET',
      url: '/api/calendar/events?from=2025-01-01T00:00:00Z&to=2025-02-01T00:00:00Z',
    });
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

  it('window overlap: picks up events that started before "from" but end inside', async () => {
    // Event that starts at 23:00 UTC on 2025-03-09 and ends at 01:00 UTC on 2025-03-10
    ctx.deps.db
      .insert(schema.calendarEvents)
      .values({
        id: 'ev-overnight',
        calendarListId: 'list-a',
        googleEventId: 'g-over',
        title: 'Overnight',
        allDay: false,
        startAt: '2025-03-09T23:00:00.000Z',
        endAt: '2025-03-10T01:00:00.000Z',
        status: 'confirmed',
      })
      .run();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/calendar/events?from=2025-03-10&to=2025-03-10',
      headers: { cookie: cookieFor('u-a') },
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().events.map((e: { id: string }) => e.id);
    expect(ids).toContain('ev-overnight');
  });

  it('window overlap: picks up multi-day all-day events that span the window', async () => {
    ctx.deps.db
      .insert(schema.calendarEvents)
      .values({
        id: 'ev-trip',
        calendarListId: 'list-a',
        googleEventId: 'g-trip',
        title: 'Trip',
        allDay: true,
        startDate: '2025-05-01',
        endDateExclusive: '2025-05-10',
        status: 'confirmed',
      })
      .run();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/calendar/events?from=2025-05-05&to=2025-05-05',
      headers: { cookie: cookieFor('u-a') },
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().events.map((e: { id: string }) => e.id);
    expect(ids).toContain('ev-trip');
  });

  it('scope=household returns events from all users with owner fields', async () => {
    // Give u-b their own account + event
    const crypto = makeTokenCrypto(deriveTokenKey(ctx.deps.env));
    ctx.deps.db
      .insert(schema.calendarAccounts)
      .values({
        id: 'acc-b',
        userId: 'u-b',
        googleSub: 'sub-b',
        email: 'b@example.com',
        refreshTokenEnc: crypto.seal('rt-b'),
        scopes: 'x',
        status: 'active',
      })
      .run();
    ctx.deps.db
      .insert(schema.calendarLists)
      .values({
        id: 'list-b',
        accountId: 'acc-b',
        googleCalendarId: 'primary',
        summary: 'B',
        primary: true,
        selected: true,
      })
      .run();
    ctx.deps.db
      .insert(schema.calendarEvents)
      .values({
        id: 'ev-b',
        calendarListId: 'list-b',
        googleEventId: 'gb',
        title: 'B event',
        allDay: false,
        startAt: '2025-03-10T14:00:00.000Z',
        endAt: '2025-03-10T15:00:00.000Z',
        status: 'confirmed',
      })
      .run();

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/calendar/events?from=2025-03-10&to=2025-03-10&scope=household',
      headers: { cookie: cookieFor('u-a') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scope).toBe('household');
    const byId = Object.fromEntries(
      (body.events as Array<{ id: string; ownerUserId: string; ownerDisplayName: string }>).map(
        (e) => [e.id, e],
      ),
    );
    expect(byId['ev-in']?.ownerUserId).toBe('u-a');
    expect(byId['ev-b']?.ownerUserId).toBe('u-b');
    expect(byId['ev-b']?.ownerDisplayName).toBe('B');
  });

  it('scope=invalid returns 400', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/calendar/events?from=2025-03-01&to=2025-03-31&scope=bogus',
      headers: { cookie: cookieFor('u-a') },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('household roster', () => {
  it('requires auth', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/household/members' });
    expect(res.statusCode).toBe(401);
  });

  it('returns all members with non-sensitive fields', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/household/members',
      headers: { cookie: cookieFor('u-a') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.members).toHaveLength(2);
    const first = body.members[0];
    expect(Object.keys(first).sort()).toEqual(['color', 'displayName', 'id', 'pictureUrl']);
  });
});
