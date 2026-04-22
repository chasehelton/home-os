import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@home-os/db';
import { makeTestApp } from './_helpers.js';
import { createSession, SESSION_COOKIE } from '../src/auth/sessions.js';
import { makeTokenCrypto, deriveTokenKey } from '../src/auth/crypto.js';

let ctx: Awaited<ReturnType<typeof makeTestApp>>;

const WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function stubFetch(
  responder: (info: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: unknown;
  }) => {
    status: number;
    body: unknown;
  },
): typeof fetch {
  return (async (input: URL | string | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const k of Object.keys(h)) headers[k.toLowerCase()] = h[k]!;
    }
    let body: unknown = undefined;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const r = responder({ method: init?.method ?? 'GET', url, headers, body });
    const nullBody = r.status === 204 || r.status === 205 || r.status === 304;
    return new Response(nullBody ? null : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
}

async function setup(withWriteScope = true) {
  ctx = await makeTestApp();
  const db = ctx.deps.db;
  db.insert(schema.users)
    .values({
      id: 'u-a',
      googleSub: 'sub-a',
      email: 'a@example.com',
      emailVerified: true,
      displayName: 'A',
    })
    .run();
  db.insert(schema.users)
    .values({ id: 'u-b', email: 'b@x', emailVerified: true, displayName: 'B' })
    .run();
  const crypto = makeTokenCrypto(deriveTokenKey(ctx.deps.env));
  db.insert(schema.calendarAccounts)
    .values({
      id: 'acc-a',
      userId: 'u-a',
      googleSub: 'sub-a',
      email: 'a@example.com',
      refreshTokenEnc: crypto.seal('rt'),
      scopes: withWriteScope ? `openid email ${WRITE_SCOPE}` : 'openid email',
      status: 'active',
    })
    .run();
  db.insert(schema.calendarLists)
    .values({
      id: 'list-primary',
      accountId: 'acc-a',
      googleCalendarId: 'primary',
      summary: 'Primary',
      primary: true,
      selected: true,
    })
    .run();
  db.insert(schema.calendarLists)
    .values({
      id: 'list-other',
      accountId: 'acc-a',
      googleCalendarId: 'other@group',
      summary: 'Other',
      primary: false,
      selected: true,
    })
    .run();
}

function cookieFor(userId: string): string {
  const { id } = createSession(ctx.deps.db, { userId });
  const signed = (ctx.app as unknown as { signCookie: (v: string) => string }).signCookie(id);
  return `${SESSION_COOKIE}=${encodeURIComponent(signed)}`;
}

function installGoogleFetch(responder: Parameters<typeof stubFetch>[0]) {
  // The write path reads cfg.fetchImpl via app.calendarSyncCfg.
  (ctx.app.calendarSyncCfg as { fetchImpl?: typeof fetch }).fetchImpl = stubFetch(responder);
}

beforeEach(async () => {
  await setup();
});

afterEach(async () => {
  await ctx.cleanup();
});

describe('calendar write routes', () => {
  it('POST /api/calendar/events requires auth', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/calendar/events',
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST creates an event and pushes to Google', async () => {
    installGoogleFetch((c) => {
      if (c.url.startsWith('https://oauth2.googleapis.com/token')) {
        return { status: 200, body: { access_token: 'at', expires_in: 3600 } };
      }
      if (c.method === 'POST' && c.url.includes('/events')) {
        return {
          status: 200,
          body: {
            id: 'g-new-1',
            etag: '"etag-1"',
            status: 'confirmed',
            htmlLink: 'https://calendar.google.com/x',
          },
        };
      }
      return { status: 500, body: {} };
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/calendar/events',
      headers: { cookie: cookieFor('u-a') },
      payload: {
        calendarListId: 'list-primary',
        title: 'Lunch',
        allDay: false,
        startAt: '2025-03-10T12:00:00.000Z',
        endAt: '2025-03-10T13:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.event.title).toBe('Lunch');
    expect(body.event.googleEventId).toBe('g-new-1');
    expect(body.event.localDirty).toBe(false);
  });

  it('POST rejects non-primary calendar with 403', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/calendar/events',
      headers: { cookie: cookieFor('u-a') },
      payload: {
        calendarListId: 'list-other',
        title: 'Nope',
        allDay: false,
        startAt: '2025-03-10T12:00:00.000Z',
        endAt: '2025-03-10T13:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('not_primary_calendar');
  });

  it('POST returns 403 when account lacks write scope', async () => {
    await ctx.cleanup();
    await setup(false);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/calendar/events',
      headers: { cookie: cookieFor('u-a') },
      payload: {
        calendarListId: 'list-primary',
        title: 'Lunch',
        allDay: false,
        startAt: '2025-03-10T12:00:00.000Z',
        endAt: '2025-03-10T13:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('write_scope_missing');
  });

  it('PATCH on a recurring event returns 409', async () => {
    ctx.deps.db
      .insert(schema.calendarEvents)
      .values({
        id: 'rec1',
        calendarListId: 'list-primary',
        googleEventId: 'g-rec',
        etag: '"e"',
        status: 'confirmed',
        allDay: false,
        startAt: '2025-03-10T12:00:00.000Z',
        endAt: '2025-03-10T13:00:00.000Z',
        recurringEventId: 'series-1',
      })
      .run();
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/calendar/events/rec1',
      headers: { cookie: cookieFor('u-a') },
      payload: { title: 'no' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('recurring_edit_unsupported');
  });

  it('PATCH on another user event returns 404 (no existence leak)', async () => {
    ctx.deps.db
      .insert(schema.calendarEvents)
      .values({
        id: 'ev-a',
        calendarListId: 'list-primary',
        googleEventId: 'g-a',
        status: 'confirmed',
        allDay: false,
        startAt: '2025-03-10T12:00:00.000Z',
        endAt: '2025-03-10T13:00:00.000Z',
      })
      .run();
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/calendar/events/ev-a',
      headers: { cookie: cookieFor('u-b') },
      payload: { title: 'mine now' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE removes the event (push to Google returns 204)', async () => {
    ctx.deps.db
      .insert(schema.calendarEvents)
      .values({
        id: 'ev-d',
        calendarListId: 'list-primary',
        googleEventId: 'g-d',
        etag: '"e"',
        status: 'confirmed',
        allDay: false,
        startAt: '2025-03-10T12:00:00.000Z',
        endAt: '2025-03-10T13:00:00.000Z',
      })
      .run();
    installGoogleFetch((c) => {
      if (c.url.startsWith('https://oauth2.googleapis.com/token')) {
        return { status: 200, body: { access_token: 'at', expires_in: 3600 } };
      }
      if (c.method === 'DELETE') return { status: 204, body: {} };
      return { status: 500, body: {} };
    });
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/calendar/events/ev-d',
      headers: { cookie: cookieFor('u-a') },
    });
    expect(res.statusCode).toBe(204);
    const remain = ctx.deps.db
      .select()
      .from(schema.calendarEvents)
      .where(eq(schema.calendarEvents.id, 'ev-d'))
      .get();
    expect(remain).toBeUndefined();
  });

  it('account list includes canWrite flag derived from scopes', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/calendar/accounts',
      headers: { cookie: cookieFor('u-a') },
    });
    expect(res.statusCode).toBe(200);
    const acc = res.json().accounts[0];
    expect(acc.canWrite).toBe(true);
  });

  it('GET /api/calendar/events hides pending-delete tombstones', async () => {
    ctx.deps.db
      .insert(schema.calendarEvents)
      .values({
        id: 'ev-tomb',
        calendarListId: 'list-primary',
        googleEventId: 'g-tomb',
        status: 'confirmed',
        allDay: false,
        startAt: '2025-03-10T12:00:00.000Z',
        endAt: '2025-03-10T13:00:00.000Z',
        localDirty: true,
        pendingOp: 'delete',
      })
      .run();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/calendar/events?from=2025-03-10&to=2025-03-10',
      headers: { cookie: cookieFor('u-a') },
    });
    const ids = res.json().events.map((e: { id: string }) => e.id);
    expect(ids).not.toContain('ev-tomb');
  });
});
