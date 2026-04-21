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
      { id: 'u-jane', email: 'jane@example.com', emailVerified: true, displayName: 'Jane', googleSub: 'g1' },
      { id: 'u-john', email: 'john@example.com', emailVerified: true, displayName: 'John', googleSub: 'g2' },
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

describe('todo routes', () => {
  it('requires auth', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/todos' });
    expect(res.statusCode).toBe(401);
  });

  it('creates and lists a household todo', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/todos',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { scope: 'household', title: 'Buy milk' },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({
      scope: 'household',
      ownerUserId: null,
      title: 'Buy milk',
      createdBy: 'u-jane',
      completedAt: null,
    });

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/todos',
      headers: { cookie: cookieFor('u-john') },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().todos).toHaveLength(1);
    expect(list.json().todos[0].title).toBe('Buy milk');
  });

  it('hides user-scoped todos from other users', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/todos',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { scope: 'user', title: 'Personal' },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().ownerUserId).toBe('u-jane');

    const johnList = await ctx.app.inject({
      method: 'GET',
      url: '/api/todos',
      headers: { cookie: cookieFor('u-john') },
    });
    expect(johnList.json().todos).toHaveLength(0);

    const janeList = await ctx.app.inject({
      method: 'GET',
      url: '/api/todos',
      headers: { cookie: cookieFor('u-jane') },
    });
    expect(janeList.json().todos).toHaveLength(1);
  });

  it('rejects creating a user-scoped todo for someone else', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/todos',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { scope: 'user', title: 'Sneaky', ownerUserId: 'u-john' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('completes a household todo from any authenticated user', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/todos',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { scope: 'household', title: 'Trash' },
    });
    const id = create.json().id as string;
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/todos/${id}`,
      headers: { cookie: cookieFor('u-john'), 'content-type': 'application/json' },
      payload: { completedAt: new Date().toISOString() },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().completedAt).not.toBeNull();
  });

  it('cannot patch another user\'s user-scoped todo (returns 404)', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/todos',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { scope: 'user', title: 'Mine' },
    });
    const id = create.json().id as string;
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/todos/${id}`,
      headers: { cookie: cookieFor('u-john'), 'content-type': 'application/json' },
      payload: { title: 'Hijacked' },
    });
    expect(patch.statusCode).toBe(404);
  });

  it('deletes a todo', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/todos',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { scope: 'household', title: 'Tmp' },
    });
    const id = create.json().id as string;
    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/todos/${id}`,
      headers: { cookie: cookieFor('u-jane') },
    });
    expect(del.statusCode).toBe(204);
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/todos',
      headers: { cookie: cookieFor('u-jane') },
    });
    expect(list.json().todos).toHaveLength(0);
  });

  it('filters by scope=household and scope=user', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/todos',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { scope: 'household', title: 'H1' },
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/todos',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { scope: 'user', title: 'U1' },
    });
    const h = await ctx.app.inject({
      method: 'GET',
      url: '/api/todos?scope=household',
      headers: { cookie: cookieFor('u-jane') },
    });
    const u = await ctx.app.inject({
      method: 'GET',
      url: '/api/todos?scope=user',
      headers: { cookie: cookieFor('u-jane') },
    });
    expect(h.json().todos.map((t: { title: string }) => t.title)).toEqual(['H1']);
    expect(u.json().todos.map((t: { title: string }) => t.title)).toEqual(['U1']);
  });

  it('rejects invalid body', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/todos',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { scope: 'household', title: '' },
    });
    expect(res.statusCode).toBe(400);
  });
});
