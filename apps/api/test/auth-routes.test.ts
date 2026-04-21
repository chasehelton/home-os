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
