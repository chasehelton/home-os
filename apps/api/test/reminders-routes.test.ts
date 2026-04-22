import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeTestApp } from './_helpers.js';
import { createSession, SESSION_COOKIE } from '../src/auth/sessions.js';
import { schema } from '@home-os/db';

let ctx: Awaited<ReturnType<typeof makeTestApp>>;

beforeEach(async () => {
  ctx = await makeTestApp();
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

const FUTURE = '2099-01-01T10:00:00Z';
const PAST = '2000-01-01T10:00:00Z';

describe('reminder routes', () => {
  it('requires auth', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/reminders' });
    expect(res.statusCode).toBe(401);
  });

  it('creates and lists a household reminder visible to both users', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/reminders',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { scope: 'household', title: 'Trash night', fireAt: FUTURE },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({
      scope: 'household',
      ownerUserId: null,
      title: 'Trash night',
      status: 'pending',
    });

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/reminders',
      headers: { cookie: cookieFor('u-john') },
    });
    expect(list.json().reminders).toHaveLength(1);
  });

  it('hides user-scoped reminders from other users and blocks cross-user edits', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/reminders',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { scope: 'user', title: 'Personal', fireAt: FUTURE },
    });
    const id = create.json().id;

    const other = await ctx.app.inject({
      method: 'GET',
      url: '/api/reminders',
      headers: { cookie: cookieFor('u-john') },
    });
    expect(other.json().reminders).toHaveLength(0);

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/reminders/${id}`,
      headers: { cookie: cookieFor('u-john'), 'content-type': 'application/json' },
      payload: { title: 'hacked' },
    });
    expect(patch.statusCode).toBe(404);

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/reminders/${id}`,
      headers: { cookie: cookieFor('u-john') },
    });
    expect(del.statusCode).toBe(404);
  });

  it('rejects fireAt that is not a full ISO-8601 with offset', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/reminders',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { scope: 'user', title: 'nope', fireAt: '2026-04-22 10:00' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('dismiss transitions status, filters from /active, stays in list with includeDismissed=true', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/reminders',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { scope: 'household', title: 'ping', fireAt: PAST },
    });
    const id = create.json().id;

    // Run worker tick to mark it fired.
    await ctx.deps.db
      .update(schema.reminders)
      .set({ status: 'fired', firedAt: '2000-01-01T10:00:01Z' })
      .run();

    const active = await ctx.app.inject({
      method: 'GET',
      url: '/api/reminders/active',
      headers: { cookie: cookieFor('u-jane') },
    });
    expect(active.json().reminders).toHaveLength(1);

    const dismiss = await ctx.app.inject({
      method: 'POST',
      url: `/api/reminders/${id}/dismiss`,
      headers: { cookie: cookieFor('u-john') },
    });
    expect(dismiss.statusCode).toBe(200);
    expect(dismiss.json().status).toBe('dismissed');

    const activeAfter = await ctx.app.inject({
      method: 'GET',
      url: '/api/reminders/active',
      headers: { cookie: cookieFor('u-jane') },
    });
    expect(activeAfter.json().reminders).toHaveLength(0);

    const listDefault = await ctx.app.inject({
      method: 'GET',
      url: '/api/reminders',
      headers: { cookie: cookieFor('u-jane') },
    });
    expect(listDefault.json().reminders).toHaveLength(0);

    const listIncluding = await ctx.app.inject({
      method: 'GET',
      url: '/api/reminders?includeDismissed=true',
      headers: { cookie: cookieFor('u-jane') },
    });
    expect(listIncluding.json().reminders).toHaveLength(1);
  });

  it('user-scoped reminder cannot be dismissed by another user', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/reminders',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { scope: 'user', title: 'mine', fireAt: FUTURE },
    });
    const id = create.json().id;
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/reminders/${id}/dismiss`,
      headers: { cookie: cookieFor('u-john') },
    });
    expect(res.statusCode).toBe(404);
  });

  it('cannot create a user-scoped reminder for another user', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/reminders',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { scope: 'user', title: 'sneaky', fireAt: FUTURE, ownerUserId: 'u-john' },
    });
    expect(res.statusCode).toBe(403);
  });
});
