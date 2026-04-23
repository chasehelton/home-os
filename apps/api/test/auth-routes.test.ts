import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeTestApp } from './_helpers.js';
import { createSession, SESSION_COOKIE } from '../src/auth/sessions.js';
import { schema } from '@home-os/db';

let ctx: Awaited<ReturnType<typeof makeTestApp>>;

beforeEach(async () => {
  ctx = await makeTestApp({ HOME_OS_ALLOWED_EMAILS: 'jane@example.com' });
});
afterEach(async () => {
  await ctx.cleanup();
});

function signedSidCookie(app: typeof ctx.app, sessionId: string): string {
  // @fastify/cookie attaches `signCookie` for tests; mirror it.
  const signed = (app as unknown as { signCookie: (v: string) => string }).signCookie(sessionId);
  return `${SESSION_COOKIE}=${encodeURIComponent(signed)}`;
}

describe('auth routes', () => {
  it('GET /api/me returns 401 without a session', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/me returns 401 with a tampered cookie', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: `${SESSION_COOKIE}=garbage` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/me returns the user when session is valid', async () => {
    ctx.deps.db
      .insert(schema.users)
      .values({
        id: 'u1',
        email: 'jane@example.com',
        emailVerified: true,
        displayName: 'Jane',
        googleSub: 'g1',
      })
      .run();
    const { id } = createSession(ctx.deps.db, { userId: 'u1' });
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: signedSidCookie(ctx.app, id) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'u1', email: 'jane@example.com' });
  });

  it('POST /auth/logout clears the session row and cookie', async () => {
    ctx.deps.db
      .insert(schema.users)
      .values({
        id: 'u1',
        email: 'jane@example.com',
        emailVerified: true,
        displayName: 'Jane',
        googleSub: 'g1',
      })
      .run();
    const { id } = createSession(ctx.deps.db, { userId: 'u1' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: signedSidCookie(ctx.app, id) },
    });
    expect(res.statusCode).toBe(200);
    const sessions = ctx.deps.db.select().from(schema.sessions).all();
    expect(sessions).toHaveLength(0);
  });

  it('GET /auth/google/login returns 503 when OAuth is not configured', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/auth/google/login' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'oauth_not_configured' });
  });
});

describe('POST /auth/kiosk', () => {
  const TOKEN = 'k'.repeat(48);
  const EMAIL = 'kiosk@example.com';

  let kctx: Awaited<ReturnType<typeof makeTestApp>>;

  afterEach(async () => {
    if (kctx) await kctx.cleanup();
  });

  it('returns 503 when HOME_OS_KIOSK_TOKEN is not set', async () => {
    kctx = await makeTestApp({ HOME_OS_ALLOWED_EMAILS: EMAIL });
    const res = await kctx.app.inject({ method: 'POST', url: '/auth/kiosk' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'kiosk_auth_not_configured' });
  });

  it('returns 401 when Authorization header is missing', async () => {
    kctx = await makeTestApp({
      HOME_OS_KIOSK_TOKEN: TOKEN,
      HOME_OS_KIOSK_USER_EMAIL: EMAIL,
      HOME_OS_ALLOWED_EMAILS: EMAIL,
    });
    const res = await kctx.app.inject({ method: 'POST', url: '/auth/kiosk' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'invalid_kiosk_token' });
  });

  it('returns 401 with a wrong-but-same-length token', async () => {
    kctx = await makeTestApp({
      HOME_OS_KIOSK_TOKEN: TOKEN,
      HOME_OS_KIOSK_USER_EMAIL: EMAIL,
      HOME_OS_ALLOWED_EMAILS: EMAIL,
    });
    const res = await kctx.app.inject({
      method: 'POST',
      url: '/auth/kiosk',
      headers: { authorization: `Bearer ${'x'.repeat(48)}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with a wrong-length token (no throw on length mismatch)', async () => {
    kctx = await makeTestApp({
      HOME_OS_KIOSK_TOKEN: TOKEN,
      HOME_OS_KIOSK_USER_EMAIL: EMAIL,
      HOME_OS_ALLOWED_EMAILS: EMAIL,
    });
    const res = await kctx.app.inject({
      method: 'POST',
      url: '/auth/kiosk',
      headers: { authorization: `Bearer short` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'invalid_kiosk_token' });
  });

  it('returns 500 when configured email is not in the allowlist', async () => {
    kctx = await makeTestApp({
      HOME_OS_KIOSK_TOKEN: TOKEN,
      HOME_OS_KIOSK_USER_EMAIL: EMAIL,
      HOME_OS_ALLOWED_EMAILS: 'someone-else@example.com',
    });
    const res = await kctx.app.inject({
      method: 'POST',
      url: '/auth/kiosk',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'kiosk_user_not_allowlisted' });
  });

  it('creates a user on first call and mints a signed sid cookie', async () => {
    kctx = await makeTestApp({
      HOME_OS_KIOSK_TOKEN: TOKEN,
      HOME_OS_KIOSK_USER_EMAIL: EMAIL,
      HOME_OS_ALLOWED_EMAILS: EMAIL,
    });
    const res = await kctx.app.inject({
      method: 'POST',
      url: '/auth/kiosk',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
    expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(true);

    const users = kctx.deps.db.select().from(schema.users).all();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: EMAIL, googleSub: null, emailVerified: true });

    const sessions = kctx.deps.db.select().from(schema.sessions).all();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ authMethod: 'kiosk' });

    // Follow-up request using the cookie should now resolve the user.
    const sidCookie = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
    const sidValue = sidCookie.split(';')[0];
    const me = await kctx.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: sidValue },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: EMAIL });
  });

  it('reuses the existing user row on subsequent calls', async () => {
    kctx = await makeTestApp({
      HOME_OS_KIOSK_TOKEN: TOKEN,
      HOME_OS_KIOSK_USER_EMAIL: EMAIL,
      HOME_OS_ALLOWED_EMAILS: EMAIL,
    });
    for (let i = 0; i < 3; i++) {
      const res = await kctx.app.inject({
        method: 'POST',
        url: '/auth/kiosk',
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(res.statusCode).toBe(200);
    }
    const users = kctx.deps.db.select().from(schema.users).all();
    expect(users).toHaveLength(1);
    const sessions = kctx.deps.db.select().from(schema.sessions).all();
    expect(sessions).toHaveLength(3);
    expect(sessions.every((s) => s.authMethod === 'kiosk')).toBe(true);
  });
});
