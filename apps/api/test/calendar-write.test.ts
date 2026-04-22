import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@home-os/db';
import { makeTestApp } from './_helpers.js';
import {
  createLocalEvent,
  deleteLocalEvent,
  pushPendingForAccount,
  updateLocalEvent,
  WriteError,
} from '../src/calendar/write.js';
import type { AccountRow, SyncConfig } from '../src/calendar/sync.js';
import { syncAccount } from '../src/calendar/sync.js';
import { makeTokenCrypto, deriveTokenKey } from '../src/auth/crypto.js';

// --- Fake Google endpoints capture calls + return canned responses -------

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

interface Responder {
  (call: Call): { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;
}

function makeFetch(responder: Responder, calls: Call[] = []): typeof fetch {
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
    const call: Call = { method: init?.method ?? 'GET', url, headers, body };
    calls.push(call);
    const r = await responder(call);
    // 204/205/304 responses must have a null body per the Fetch spec.
    const nullBody = r.status === 204 || r.status === 205 || r.status === 304;
    return new Response(
      nullBody ? null : typeof r.body === 'string' ? r.body : JSON.stringify(r.body),
      { status: r.status }
    );
  }) as unknown as typeof fetch;
}

async function seed(ctx: Awaited<ReturnType<typeof makeTestApp>>) {
  const db = ctx.deps.db;
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
      refreshTokenEnc: crypto.seal('rt'),
      scopes: 'openid email profile https://www.googleapis.com/auth/calendar.events',
      status: 'active',
    })
    .run();
  db.insert(schema.calendarLists)
    .values({
      id: 'list1',
      accountId: 'acc1',
      googleCalendarId: 'primary',
      summary: 'Primary',
      primary: true,
      selected: true,
    })
    .run();
  const account = db
    .select()
    .from(schema.calendarAccounts)
    .where(eq(schema.calendarAccounts.id, 'acc1'))
    .get() as AccountRow;
  const cfg: SyncConfig = {
    clientId: 'cid',
    clientSecret: 'csec',
    crypto,
    fetchImpl: undefined,
  };
  return { db, account, cfg };
}

function withFetch(cfg: SyncConfig, fetchImpl: typeof fetch): SyncConfig {
  return { ...cfg, fetchImpl };
}

describe('calendar write — local mutations', () => {
  let ctx: Awaited<ReturnType<typeof makeTestApp>>;
  beforeEach(async () => {
    ctx = await makeTestApp();
    return async () => ctx.cleanup();
  });

  it('create marks a row dirty with pending_op=create and a mutationId', async () => {
    const { db } = await seed(ctx);
    const row = createLocalEvent(db, 'u1', {
      calendarListId: 'list1',
      title: 'Lunch',
      allDay: false,
      startAt: '2025-03-10T12:00:00.000Z',
      endAt: '2025-03-10T13:00:00.000Z',
    });
    expect(row.localDirty).toBe(true);
    expect(row.pendingOp).toBe('create');
    expect(row.mutationId).toBeTruthy();
    expect(row.googleEventId.startsWith('local:')).toBe(true);
  });

  it('update on a dirty create keeps pending_op=create (collapse)', async () => {
    const { db } = await seed(ctx);
    const row = createLocalEvent(db, 'u1', {
      calendarListId: 'list1',
      title: 'Lunch',
      allDay: false,
      startAt: '2025-03-10T12:00:00.000Z',
      endAt: '2025-03-10T13:00:00.000Z',
    });
    const updated = updateLocalEvent(db, 'u1', row.id, { title: 'Brunch' });
    expect(updated.title).toBe('Brunch');
    expect(updated.pendingOp).toBe('create');
  });

  it('delete on a never-pushed create drops the row outright', async () => {
    const { db } = await seed(ctx);
    const row = createLocalEvent(db, 'u1', {
      calendarListId: 'list1',
      title: 'Lunch',
      allDay: false,
      startAt: '2025-03-10T12:00:00.000Z',
      endAt: '2025-03-10T13:00:00.000Z',
    });
    const res = deleteLocalEvent(db, 'u1', row.id);
    expect(res).toBe('dropped');
    const found = db
      .select()
      .from(schema.calendarEvents)
      .where(eq(schema.calendarEvents.id, row.id))
      .get();
    expect(found).toBeUndefined();
  });

  it('refuses to edit recurring instances', async () => {
    const { db } = await seed(ctx);
    db.insert(schema.calendarEvents)
      .values({
        id: 'rec1',
        calendarListId: 'list1',
        googleEventId: 'g-rec-1',
        status: 'confirmed',
        allDay: false,
        startAt: '2025-03-10T12:00:00.000Z',
        endAt: '2025-03-10T13:00:00.000Z',
        recurringEventId: 'series-1',
      })
      .run();
    expect(() => updateLocalEvent(db, 'u1', 'rec1', { title: 'x' })).toThrow(WriteError);
    expect(() => deleteLocalEvent(db, 'u1', 'rec1')).toThrow(WriteError);
  });

  it('cross-user access returns not_found', async () => {
    const { db } = await seed(ctx);
    db.insert(schema.users)
      .values({ id: 'u2', email: 'b@x', displayName: 'B', emailVerified: true })
      .run();
    const row = createLocalEvent(db, 'u1', {
      calendarListId: 'list1',
      title: 'Lunch',
      allDay: false,
      startAt: '2025-03-10T12:00:00.000Z',
      endAt: '2025-03-10T13:00:00.000Z',
    });
    expect(() => updateLocalEvent(db, 'u2', row.id, { title: 'x' })).toThrow(WriteError);
  });

  it('rejects create on a non-primary calendar', async () => {
    const { db } = await seed(ctx);
    db.insert(schema.calendarLists)
      .values({
        id: 'list2',
        accountId: 'acc1',
        googleCalendarId: 'other',
        summary: 'Other',
        primary: false,
        selected: true,
      })
      .run();
    expect(() =>
      createLocalEvent(db, 'u1', {
        calendarListId: 'list2',
        title: 'Lunch',
        allDay: false,
        startAt: '2025-03-10T12:00:00.000Z',
        endAt: '2025-03-10T13:00:00.000Z',
      })
    ).toThrow(WriteError);
  });
});

describe('calendar write — push engine', () => {
  let ctx: Awaited<ReturnType<typeof makeTestApp>>;
  beforeEach(async () => {
    ctx = await makeTestApp();
    return async () => ctx.cleanup();
  });

  it('CREATE push: inserts event on Google, stores id + etag, clears dirty', async () => {
    const { db, account, cfg } = await seed(ctx);
    const row = createLocalEvent(db, 'u1', {
      calendarListId: 'list1',
      title: 'Lunch',
      allDay: false,
      startAt: '2025-03-10T12:00:00.000Z',
      endAt: '2025-03-10T13:00:00.000Z',
    });
    const calls: Call[] = [];
    const fetchImpl = makeFetch((c) => {
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
            extendedProperties: { private: { homeOsMutationId: row.mutationId } },
          },
        };
      }
      return { status: 500, body: { error: 'unmocked' } };
    }, calls);

    const res = await pushPendingForAccount(db, account, withFetch(cfg, fetchImpl));
    expect(res.pushed).toBe(1);
    const fresh = db
      .select()
      .from(schema.calendarEvents)
      .where(eq(schema.calendarEvents.id, row.id))
      .get();
    expect(fresh?.googleEventId).toBe('g-new-1');
    expect(fresh?.etag).toBe('"etag-1"');
    expect(fresh?.localDirty).toBe(false);
    expect(fresh?.pendingOp).toBeNull();
    // The POST body should have carried the mutationId.
    const post = calls.find((c) => c.method === 'POST' && c.url.includes('/events'));
    expect(post).toBeDefined();
    const body = post?.body as { extendedProperties?: { private?: { homeOsMutationId?: string } } };
    expect(body?.extendedProperties?.private?.homeOsMutationId).toBe(row.mutationId);
  });

  it('UPDATE push: sends If-Match and stores new etag', async () => {
    const { db, account, cfg } = await seed(ctx);
    db.insert(schema.calendarEvents)
      .values({
        id: 'e1',
        calendarListId: 'list1',
        googleEventId: 'g-1',
        etag: '"etag-old"',
        status: 'confirmed',
        allDay: false,
        startAt: '2025-03-10T12:00:00.000Z',
        endAt: '2025-03-10T13:00:00.000Z',
      })
      .run();
    updateLocalEvent(db, 'u1', 'e1', { title: 'Updated' });
    const calls: Call[] = [];
    const fetchImpl = makeFetch((c) => {
      if (c.url.startsWith('https://oauth2.googleapis.com/token')) {
        return { status: 200, body: { access_token: 'at', expires_in: 3600 } };
      }
      if (c.method === 'PATCH') {
        return { status: 200, body: { id: 'g-1', etag: '"etag-new"' } };
      }
      return { status: 500, body: { error: 'unmocked' } };
    }, calls);

    const res = await pushPendingForAccount(db, account, withFetch(cfg, fetchImpl));
    expect(res.pushed).toBe(1);
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.headers['if-match']).toBe('"etag-old"');
    const fresh = db
      .select()
      .from(schema.calendarEvents)
      .where(eq(schema.calendarEvents.id, 'e1'))
      .get();
    expect(fresh?.etag).toBe('"etag-new"');
    expect(fresh?.localDirty).toBe(false);
  });

  it('UPDATE on 412 mismatch records conflict and clears dirty', async () => {
    const { db, account, cfg } = await seed(ctx);
    db.insert(schema.calendarEvents)
      .values({
        id: 'e1',
        calendarListId: 'list1',
        googleEventId: 'g-1',
        etag: '"stale"',
        status: 'confirmed',
        allDay: false,
        startAt: '2025-03-10T12:00:00.000Z',
        endAt: '2025-03-10T13:00:00.000Z',
        title: 'orig',
      })
      .run();
    updateLocalEvent(db, 'u1', 'e1', { title: 'my change' });
    const fetchImpl = makeFetch((c) => {
      if (c.url.startsWith('https://oauth2.googleapis.com/token')) {
        return { status: 200, body: { access_token: 'at', expires_in: 3600 } };
      }
      if (c.method === 'PATCH') return { status: 412, body: { error: 'precondition' } };
      return { status: 500, body: {} };
    });
    const res = await pushPendingForAccount(db, account, withFetch(cfg, fetchImpl));
    expect(res.conflicts).toBe(1);
    const fresh = db
      .select()
      .from(schema.calendarEvents)
      .where(eq(schema.calendarEvents.id, 'e1'))
      .get();
    expect(fresh?.localDirty).toBe(false);
    expect(fresh?.conflictPayload).toBeTruthy();
    const payload = JSON.parse(fresh!.conflictPayload!);
    expect(payload.title).toBe('my change');
    expect(fresh?.etag).toBeNull(); // force re-read next sync
  });

  it('DELETE push removes the local row', async () => {
    const { db, account, cfg } = await seed(ctx);
    db.insert(schema.calendarEvents)
      .values({
        id: 'e1',
        calendarListId: 'list1',
        googleEventId: 'g-1',
        etag: '"etag"',
        status: 'confirmed',
        allDay: false,
        startAt: '2025-03-10T12:00:00.000Z',
        endAt: '2025-03-10T13:00:00.000Z',
      })
      .run();
    deleteLocalEvent(db, 'u1', 'e1');
    const fetchImpl = makeFetch((c) => {
      if (c.url.startsWith('https://oauth2.googleapis.com/token')) {
        return { status: 200, body: { access_token: 'at', expires_in: 3600 } };
      }
      if (c.method === 'DELETE') return { status: 204, body: {} };
      return { status: 500, body: {} };
    });
    const res = await pushPendingForAccount(db, account, withFetch(cfg, fetchImpl));
    expect(res.pushed).toBe(1);
    const fresh = db
      .select()
      .from(schema.calendarEvents)
      .where(eq(schema.calendarEvents.id, 'e1'))
      .get();
    expect(fresh).toBeUndefined();
  });

  it('DELETE 410 is treated as success', async () => {
    const { db, account, cfg } = await seed(ctx);
    db.insert(schema.calendarEvents)
      .values({
        id: 'e1',
        calendarListId: 'list1',
        googleEventId: 'g-1',
        status: 'confirmed',
        allDay: false,
        startAt: '2025-03-10T12:00:00.000Z',
        endAt: '2025-03-10T13:00:00.000Z',
      })
      .run();
    deleteLocalEvent(db, 'u1', 'e1');
    const fetchImpl = makeFetch((c) => {
      if (c.url.startsWith('https://oauth2.googleapis.com/token')) {
        return { status: 200, body: { access_token: 'at', expires_in: 3600 } };
      }
      if (c.method === 'DELETE') return { status: 410, body: {} };
      return { status: 500, body: {} };
    });
    const res = await pushPendingForAccount(db, account, withFetch(cfg, fetchImpl));
    expect(res.pushed).toBe(1);
  });

  it('transient 500 keeps dirty so worker retries', async () => {
    const { db, account, cfg } = await seed(ctx);
    createLocalEvent(db, 'u1', {
      calendarListId: 'list1',
      title: 'Lunch',
      allDay: false,
      startAt: '2025-03-10T12:00:00.000Z',
      endAt: '2025-03-10T13:00:00.000Z',
    });
    const fetchImpl = makeFetch((c) => {
      if (c.url.startsWith('https://oauth2.googleapis.com/token')) {
        return { status: 200, body: { access_token: 'at', expires_in: 3600 } };
      }
      return { status: 503, body: { error: 'unavailable' } };
    });
    const res = await pushPendingForAccount(db, account, withFetch(cfg, fetchImpl));
    expect(res.errors).toBe(1);
    const rows = db
      .select()
      .from(schema.calendarEvents)
      .where(eq(schema.calendarEvents.localDirty, true))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lastPushError).toBeTruthy();
  });

  it('CREATE retry is idempotent: finds existing event by mutationId', async () => {
    const { db, account, cfg } = await seed(ctx);
    const row = createLocalEvent(db, 'u1', {
      calendarListId: 'list1',
      title: 'Lunch',
      allDay: false,
      startAt: '2025-03-10T12:00:00.000Z',
      endAt: '2025-03-10T13:00:00.000Z',
    });
    // Simulate a prior failed attempt so the push engine treats this as a retry
    // and probes Google by mutationId before re-POSTing.
    db.update(schema.calendarEvents)
      .set({ lastPushAttemptAt: new Date().toISOString(), lastPushError: 'transient' })
      .where(eq(schema.calendarEvents.id, row.id))
      .run();
    const calls: Call[] = [];
    const fetchImpl = makeFetch((c) => {
      if (c.url.startsWith('https://oauth2.googleapis.com/token')) {
        return { status: 200, body: { access_token: 'at', expires_in: 3600 } };
      }
      // Simulate a previous POST succeeded: the list-by-mutation-id probe
      // returns an item. No POST should happen.
      if (c.method === 'GET' && c.url.includes('privateExtendedProperty')) {
        return {
          status: 200,
          body: {
            items: [
              {
                id: 'g-already',
                etag: '"etag-already"',
                status: 'confirmed',
                extendedProperties: { private: { homeOsMutationId: row.mutationId } },
              },
            ],
          },
        };
      }
      if (c.method === 'POST') {
        throw new Error('unexpected POST — should have reconciled');
      }
      return { status: 500, body: {} };
    }, calls);
    const res = await pushPendingForAccount(db, account, withFetch(cfg, fetchImpl));
    expect(res.pushed).toBe(1);
    const fresh = db
      .select()
      .from(schema.calendarEvents)
      .where(eq(schema.calendarEvents.id, row.id))
      .get();
    expect(fresh?.googleEventId).toBe('g-already');
    expect(fresh?.etag).toBe('"etag-already"');
  });

  it('403 insufficient-scope is non-retryable and flags the account', async () => {
    const { db, account, cfg } = await seed(ctx);
    createLocalEvent(db, 'u1', {
      calendarListId: 'list1',
      title: 'Lunch',
      allDay: false,
      startAt: '2025-03-10T12:00:00.000Z',
      endAt: '2025-03-10T13:00:00.000Z',
    });
    const fetchImpl = makeFetch((c) => {
      if (c.url.startsWith('https://oauth2.googleapis.com/token')) {
        return { status: 200, body: { access_token: 'at', expires_in: 3600 } };
      }
      return {
        status: 403,
        body: { error: { errors: [{ reason: 'insufficientPermissions' }] } },
      };
    });
    await pushPendingForAccount(db, account, withFetch(cfg, fetchImpl));
    const acc = db
      .select()
      .from(schema.calendarAccounts)
      .where(eq(schema.calendarAccounts.id, 'acc1'))
      .get();
    expect(acc?.lastError).toBe('write_scope_missing');
  });

  it('sync does NOT overwrite a dirty local update', async () => {
    const { db, account, cfg } = await seed(ctx);
    db.insert(schema.calendarEvents)
      .values({
        id: 'e1',
        calendarListId: 'list1',
        googleEventId: 'g-1',
        etag: '"old"',
        status: 'confirmed',
        allDay: false,
        startAt: '2025-03-10T12:00:00.000Z',
        endAt: '2025-03-10T13:00:00.000Z',
        title: 'server',
      })
      .run();
    updateLocalEvent(db, 'u1', 'e1', { title: 'my local' });
    // Mock: push will fail with 500 (transient), then read-sync returns the
    // server's version. The local row must NOT be clobbered.
    const fetchImpl = makeFetch((c) => {
      if (c.url.startsWith('https://oauth2.googleapis.com/token')) {
        return { status: 200, body: { access_token: 'at', expires_in: 3600 } };
      }
      if (c.method === 'PATCH') return { status: 503, body: {} };
      if (c.url.includes('/users/me/calendarList')) {
        return { status: 200, body: { items: [] } };
      }
      if (c.url.includes('/events')) {
        return {
          status: 200,
          body: {
            items: [
              {
                id: 'g-1',
                etag: '"server-new"',
                status: 'confirmed',
                summary: 'server updated',
                start: { dateTime: '2025-03-10T12:00:00Z' },
                end: { dateTime: '2025-03-10T13:00:00Z' },
              },
            ],
            nextSyncToken: 't1',
          },
        };
      }
      return { status: 500, body: {} };
    });
    await syncAccount(db, account, withFetch(cfg, fetchImpl));
    const fresh = db
      .select()
      .from(schema.calendarEvents)
      .where(eq(schema.calendarEvents.id, 'e1'))
      .get();
    expect(fresh?.title).toBe('my local');
    expect(fresh?.localDirty).toBe(true);
  });
});
