import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeTestApp } from './_helpers.js';
import { createSession, SESSION_COOKIE } from '../src/auth/sessions.js';
import { schema } from '@home-os/db';
import { eq } from 'drizzle-orm';

let ctx: Awaited<ReturnType<typeof makeTestApp>>;

beforeEach(async () => {
  ctx = await makeTestApp({
    HOME_OS_VAPID_PUBLIC_KEY: 'BTestPublicKey',
    HOME_OS_VAPID_PRIVATE_KEY: 'test-private-key',
  });
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

function cookieFor(userId: string): string {
  const { id } = createSession(ctx.deps.db, { userId });
  const signed = (ctx.app as unknown as { signCookie: (v: string) => string }).signCookie(id);
  return `${SESSION_COOKIE}=${encodeURIComponent(signed)}`;
}

const SUB = {
  endpoint: 'https://push.example.com/abc123',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
};

describe('push routes', () => {
  it('vapid-public-key returns 503 when disabled', async () => {
    const off = await (async () => {
      const helpers = await import('./_helpers.js');
      return helpers.makeTestApp(); // no VAPID keys
    })();
    try {
      const res = await off.app.inject({
        method: 'GET',
        url: '/api/push/vapid-public-key',
      });
      expect(res.statusCode).toBe(503);
    } finally {
      await off.cleanup();
    }
  });

  it('vapid-public-key returns the public key when configured', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/push/vapid-public-key' });
    expect(res.statusCode).toBe(200);
    expect(res.json().publicKey).toBe('BTestPublicKey');
  });

  it('subscribe requires auth', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers: { 'content-type': 'application/json' },
      payload: SUB,
    });
    expect(res.statusCode).toBe(401);
  });

  it('subscribe upserts and does not echo secret keys', async () => {
    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { ...SUB, userAgent: 'Firefox' },
    });
    expect(first.statusCode).toBe(201);
    const body = first.json();
    expect(body).not.toHaveProperty('p256dh');
    expect(body).not.toHaveProperty('auth');
    expect(body).not.toHaveProperty('endpoint');

    // Same endpoint re-subscribed under a different user reassigns it.
    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers: { cookie: cookieFor('u-john'), 'content-type': 'application/json' },
      payload: SUB,
    });
    expect(second.statusCode).toBe(201);

    const row = ctx.deps.db
      .select()
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.endpoint, SUB.endpoint))
      .get();
    expect(row?.userId).toBe('u-john');
    // Unique-by-endpoint enforced.
    const all = ctx.deps.db.select().from(schema.pushSubscriptions).all();
    expect(all).toHaveLength(1);
  });

  it('unsubscribe only deletes the caller’s own subscription', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: SUB,
    });

    const otherTry = await ctx.app.inject({
      method: 'POST',
      url: '/api/push/unsubscribe',
      headers: { cookie: cookieFor('u-john'), 'content-type': 'application/json' },
      payload: { endpoint: SUB.endpoint },
    });
    expect(otherTry.json().removed).toBe(false);
    expect(ctx.deps.db.select().from(schema.pushSubscriptions).all()).toHaveLength(1);

    const owner = await ctx.app.inject({
      method: 'POST',
      url: '/api/push/unsubscribe',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { endpoint: SUB.endpoint },
    });
    expect(owner.json().removed).toBe(true);
    expect(ctx.deps.db.select().from(schema.pushSubscriptions).all()).toHaveLength(0);
  });

  it('rejects malformed subscribe payloads', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { endpoint: 'not-a-url', keys: { p256dh: 'x', auth: 'y' } },
    });
    expect(res.statusCode).toBe(400);
  });
});
