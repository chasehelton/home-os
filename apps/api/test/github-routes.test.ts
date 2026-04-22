import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { schema } from '@home-os/db';
import { eq } from 'drizzle-orm';
import { makeTestApp } from './_helpers.js';
import { createSession, SESSION_COOKIE } from '../src/auth/sessions.js';
import { makeTokenCrypto, deriveTokenKey } from '../src/auth/crypto.js';

let ctx: Awaited<ReturnType<typeof makeTestApp>>;

function cookieFor(userId: string): string {
  const { id } = createSession(ctx.deps.db, { userId });
  const signed = (ctx.app as unknown as { signCookie: (v: string) => string }).signCookie(id);
  return `${SESSION_COOKIE}=${encodeURIComponent(signed)}`;
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function setup(over: Partial<ReturnType<typeof import('./_helpers.js').makeTestEnv>> = {}) {
  ctx = await makeTestApp(over);
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

async function setupWithFetch(fetchImpl: typeof fetch) {
  // We need fetchImpl injection into the app. Re-import and call buildApp directly.
  const { buildApp } = await import('../src/app.js');
  const { runMigrations } = await import('@home-os/db');
  const { makeTestEnv } = await import('./_helpers.js');
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const { nanoid } = await import('nanoid');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `home-os-test-${nanoid(6)}-`));
  runMigrations({ dataDir });
  const env = makeTestEnv({ HOME_OS_AI_PROVIDER: 'copilot' });
  const built = await buildApp({ env, dataDir, fetchImpl });
  ctx = {
    app: built.app,
    deps: built.deps,
    dataDir,
    cleanup: async () => {
      await built.app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
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

describe('github routes — device flow', () => {
  it('status requires auth', async () => {
    await setup();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/github/status' });
    expect(res.statusCode).toBe(401);
  });

  it('status reports not connected when no account', async () => {
    await setup();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/github/status',
      headers: { cookie: cookieFor('u-a') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ connected: false, pendingAuthorization: false });
  });

  it('device/start returns user_code; poll returns pending then ok and stores account', async () => {
    const fetchImpl = vi.fn(async (url: string, _init: RequestInit) => {
      if (url.endsWith('/login/device/code')) {
        return json({
          device_code: 'dev-code-xyz',
          user_code: 'ABCD-1234',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 1,
        });
      }
      if (url.endsWith('/login/oauth/access_token')) {
        // First poll: pending. Second poll: success.
        pollCount += 1;
        if (pollCount === 1) return json({ error: 'authorization_pending' });
        return json({ access_token: 'gho_user_token', token_type: 'bearer', scope: 'read:user' });
      }
      if (url === 'https://api.github.com/user') {
        return json({ id: 12345, login: 'octo-resident' });
      }
      throw new Error(`unrouted: ${url}`);
    }) as unknown as typeof fetch;
    let pollCount = 0;
    await setupWithFetch(fetchImpl);

    const start = await ctx.app.inject({
      method: 'POST',
      url: '/api/github/device/start',
      headers: { cookie: cookieFor('u-a'), 'content-type': 'application/json' },
      payload: {},
    });
    expect(start.statusCode).toBe(200);
    expect(start.json()).toMatchObject({
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
    });

    const poll1 = await ctx.app.inject({
      method: 'POST',
      url: '/api/github/device/poll',
      headers: { cookie: cookieFor('u-a'), 'content-type': 'application/json' },
      payload: {},
    });
    expect(poll1.statusCode).toBe(200);
    expect(poll1.json()).toMatchObject({ status: 'pending', reason: 'authorization_pending' });

    const poll2 = await ctx.app.inject({
      method: 'POST',
      url: '/api/github/device/poll',
      headers: { cookie: cookieFor('u-a'), 'content-type': 'application/json' },
      payload: {},
    });
    expect(poll2.statusCode).toBe(200);
    expect(poll2.json()).toMatchObject({
      status: 'ok',
      account: { githubLogin: 'octo-resident', githubUserId: 12345 },
    });

    // Token should be stored encrypted — verify by decrypting directly.
    const row = ctx.deps.db
      .select()
      .from(schema.githubAccounts)
      .where(eq(schema.githubAccounts.userId, 'u-a'))
      .get();
    expect(row).toBeDefined();
    expect(row!.githubLogin).toBe('octo-resident');
    const crypto = makeTokenCrypto(deriveTokenKey(ctx.deps.env));
    expect(crypto.open(row!.accessTokenEnc)).toBe('gho_user_token');
  });

  it('poll without pending returns 404', async () => {
    await setup();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/github/device/poll',
      headers: { cookie: cookieFor('u-a'), 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'no_pending_authorization' });
  });

  it('DELETE /api/github/account removes the connection', async () => {
    await setup();
    ctx.deps.db
      .insert(schema.githubAccounts)
      .values({
        id: 'gha-1',
        userId: 'u-a',
        githubUserId: 99,
        githubLogin: 'octo',
        accessTokenEnc: 'v1:xxx',
        scopes: 'read:user',
      })
      .run();
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/github/account',
      headers: { cookie: cookieFor('u-a') },
    });
    expect(res.statusCode).toBe(200);
    const row = ctx.deps.db
      .select()
      .from(schema.githubAccounts)
      .where(eq(schema.githubAccounts.userId, 'u-a'))
      .get();
    expect(row).toBeUndefined();
  });
});

describe('ai routes (copilot provider)', () => {
  beforeEach(async () => {
    await setup({ HOME_OS_AI_PROVIDER: 'copilot' });
  });

  it('status reports needsGithub=true when user has no GitHub account', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/ai/status',
      headers: { cookie: cookieFor('u-a') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ provider: 'copilot', enabled: true, needsGithub: true });
  });

  it('/api/ai/parse returns 403 github_not_connected when user has no GitHub account', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/ai/parse',
      headers: { cookie: cookieFor('u-a'), 'content-type': 'application/json' },
      payload: { prompt: 'add milk' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'github_not_connected' });
  });
});
