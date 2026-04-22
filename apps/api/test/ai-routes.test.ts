import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { schema } from '@home-os/db';
import { makeTestApp, makeTestEnv } from './_helpers.js';
import { createSession, SESSION_COOKIE } from '../src/auth/sessions.js';
import { makeTokenCrypto, deriveTokenKey } from '../src/auth/crypto.js';

let ctx: Awaited<ReturnType<typeof makeTestApp>>;

const WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function cookieFor(userId: string): string {
  const { id } = createSession(ctx.deps.db, { userId });
  const signed = (ctx.app as unknown as { signCookie: (v: string) => string }).signCookie(id);
  return `${SESSION_COOKIE}=${encodeURIComponent(signed)}`;
}

async function setup(env: Partial<ReturnType<typeof makeTestEnv>> = {}) {
  ctx = await makeTestApp(env);
  ctx.deps.db
    .insert(schema.users)
    .values({
      id: 'u-a',
      googleSub: 'sub-a',
      email: 'a@example.com',
      emailVerified: true,
      displayName: 'A',
    })
    .run();
}

afterEach(async () => {
  if (ctx) await ctx.cleanup();
});

describe('ai routes (disabled provider, default)', () => {
  beforeEach(async () => {
    await setup();
  });

  it('GET /api/ai/status requires auth', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/ai/status' });
    expect(res.statusCode).toBe(401);
  });

  it('reports disabled provider', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/ai/status',
      headers: { cookie: cookieFor('u-a') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ provider: 'disabled', enabled: false });
  });

  it('POST /api/ai/parse returns 503 when disabled', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/ai/parse',
      headers: { cookie: cookieFor('u-a'), 'content-type': 'application/json' },
      payload: { prompt: 'add milk' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('ai_disabled');
  });

  it('POST /api/ai/parse validates body', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/ai/parse',
      headers: { cookie: cookieFor('u-a'), 'content-type': 'application/json' },
      payload: { prompt: '' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('ai routes (mock provider)', () => {
  beforeEach(async () => {
    await setup({ HOME_OS_AI_PROVIDER: 'mock' });
  });

  it('parse → execute creates a todo end-to-end', async () => {
    const parse = await ctx.app.inject({
      method: 'POST',
      url: '/api/ai/parse',
      headers: { cookie: cookieFor('u-a'), 'content-type': 'application/json' },
      payload: { prompt: 'add milk to the shared todo list' },
    });
    expect(parse.statusCode).toBe(200);
    const { toolCalls } = parse.json() as { toolCalls: unknown[] };
    expect(toolCalls).toEqual([
      { tool: 'create_todo', args: { title: 'milk', scope: 'household' } },
    ]);

    const execute = await ctx.app.inject({
      method: 'POST',
      url: '/api/ai/execute',
      headers: { cookie: cookieFor('u-a'), 'content-type': 'application/json' },
      payload: { prompt: 'add milk to the shared todo list', toolCalls },
    });
    expect(execute.statusCode).toBe(200);
    const out = execute.json() as { outcomes: Array<{ ok: boolean; entityType: string }> };
    expect(out.outcomes).toHaveLength(1);
    expect(out.outcomes[0]?.ok).toBe(true);
    expect(out.outcomes[0]?.entityType).toBe('todo');

    const todos = ctx.deps.db.select().from(schema.todos).all();
    expect(todos).toHaveLength(1);
    expect(todos[0]?.title).toBe('milk');
    expect(todos[0]?.scope).toBe('household');

    const transcripts = ctx.deps.db.select().from(schema.aiTranscripts).all();
    // one parse + one execute row persisted.
    expect(transcripts).toHaveLength(2);
  });

  it('execute rejects invalid ToolCall body', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/ai/execute',
      headers: { cookie: cookieFor('u-a'), 'content-type': 'application/json' },
      payload: {
        prompt: 'x',
        toolCalls: [{ tool: 'create_todo', args: { scope: 'nope' } }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('create_event fails gracefully when no writable primary calendar', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/ai/execute',
      headers: { cookie: cookieFor('u-a'), 'content-type': 'application/json' },
      payload: {
        prompt: 'schedule lunch',
        toolCalls: [
          {
            tool: 'create_event',
            args: {
              title: 'Lunch',
              startAt: '2026-05-01T12:00:00.000Z',
              endAt: '2026-05-01T13:00:00.000Z',
            },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const out = res.json() as { outcomes: Array<{ ok: boolean; error?: string }> };
    expect(out.outcomes[0]?.ok).toBe(false);
    expect(out.outcomes[0]?.error).toBe('no_writable_primary_calendar');
  });

  it('create_event actually writes a local row when a writable primary exists', async () => {
    // Seed a writable primary calendar; stub the Google push so it fails
    // without throwing (push errors are non-fatal: the worker retries).
    const crypto = makeTokenCrypto(deriveTokenKey(ctx.deps.env));
    ctx.deps.db
      .insert(schema.calendarAccounts)
      .values({
        id: 'acc-a',
        userId: 'u-a',
        googleSub: 'sub-a',
        email: 'a@example.com',
        refreshTokenEnc: crypto.seal('rt'),
        scopes: `openid email ${WRITE_SCOPE}`,
        status: 'active',
      })
      .run();
    ctx.deps.db
      .insert(schema.calendarLists)
      .values({
        id: 'list-primary',
        accountId: 'acc-a',
        googleCalendarId: 'primary',
        summary: 'Primary',
        primary: true,
        selected: true,
      })
      .run();
    // Force the push to fail so the test doesn't need a full Google stub.
    (ctx.app.calendarSyncCfg as { fetchImpl?: typeof fetch }).fetchImpl = (async () => {
      return new Response('{}', { status: 500 });
    }) as unknown as typeof fetch;

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/ai/execute',
      headers: { cookie: cookieFor('u-a'), 'content-type': 'application/json' },
      payload: {
        prompt: 'schedule lunch',
        toolCalls: [
          {
            tool: 'create_event',
            args: {
              title: 'Lunch',
              startAt: '2026-05-01T12:00:00.000Z',
              endAt: '2026-05-01T13:00:00.000Z',
            },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const out = res.json() as { outcomes: Array<{ ok: boolean; entityType?: string }> };
    expect(out.outcomes[0]?.ok).toBe(true);
    expect(out.outcomes[0]?.entityType).toBe('calendar_event');
    const events = ctx.deps.db.select().from(schema.calendarEvents).all();
    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe('Lunch');
    expect(events[0]?.localDirty).toBe(true);
  });

  it('rate limits after N requests in a window', async () => {
    const cookie = cookieFor('u-a');
    let last = 0;
    for (let i = 0; i < 10; i += 1) {
      const r = await ctx.app.inject({
        method: 'POST',
        url: '/api/ai/parse',
        headers: { cookie, 'content-type': 'application/json' },
        payload: { prompt: 'no-op prompt' },
      });
      last = r.statusCode;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });

  it('lists transcripts scoped to the caller', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/ai/parse',
      headers: { cookie: cookieFor('u-a'), 'content-type': 'application/json' },
      payload: { prompt: 'add milk' },
    });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/ai/transcripts',
      headers: { cookie: cookieFor('u-a') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { transcripts: Array<{ prompt: string }> };
    expect(body.transcripts).toHaveLength(1);
    expect(body.transcripts[0]?.prompt).toBe('add milk');
  });
});
