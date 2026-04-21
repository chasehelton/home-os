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
  ctx.deps.db
    .insert(schema.recipes)
    .values({
      id: 'r-pasta',
      title: 'Pasta',
      importStatus: 'manual',
      createdBy: 'u-jane',
    })
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

describe('meal plan routes', () => {
  it('requires auth', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/meal-plan' });
    expect(res.statusCode).toBe(401);
  });

  it('creates and lists an entry in the weekly window', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/meal-plan',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { date: '2026-05-04', slot: 'dinner', recipeId: 'r-pasta' },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({
      date: '2026-05-04',
      slot: 'dinner',
      recipeId: 'r-pasta',
      createdBy: 'u-jane',
    });

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/meal-plan?weekStart=2026-05-03',
      headers: { cookie: cookieFor('u-john') },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.from).toBe('2026-05-03');
    expect(body.to).toBe('2026-05-09');
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].slot).toBe('dinner');
  });

  it('excludes entries outside the week window', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/meal-plan',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { date: '2026-04-27', slot: 'dinner', title: 'Leftovers' },
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/meal-plan',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { date: '2026-05-05', slot: 'dinner', title: 'In-week' },
    });
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/meal-plan?weekStart=2026-05-03',
      headers: { cookie: cookieFor('u-jane') },
    });
    const titles = (list.json().entries as Array<{ title: string }>).map((e) => e.title);
    expect(titles).toEqual(['In-week']);
  });

  it('rejects an entry with neither recipeId nor title', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/meal-plan',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { date: '2026-05-04', slot: 'lunch' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid date format', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/meal-plan',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { date: '05/04/2026', slot: 'dinner', title: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('updates and deletes an entry', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/meal-plan',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { date: '2026-05-04', slot: 'dinner', title: 'TBD' },
    });
    const id = create.json().id as string;
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/meal-plan/${id}`,
      headers: { cookie: cookieFor('u-john'), 'content-type': 'application/json' },
      payload: { title: 'Tacos', notes: 'double the guac' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toMatchObject({ title: 'Tacos', notes: 'double the guac' });

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/meal-plan/${id}`,
      headers: { cookie: cookieFor('u-john') },
    });
    expect(del.statusCode).toBe(204);
  });

  it('returns 404 when updating/deleting a missing entry', async () => {
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/meal-plan/does-not-exist',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { title: 'Ghost' },
    });
    expect(patch.statusCode).toBe(404);
    const del = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/meal-plan/does-not-exist',
      headers: { cookie: cookieFor('u-jane') },
    });
    expect(del.statusCode).toBe(404);
  });

  it('clears recipeId when set to null (e.g. recipe replaced with free text)', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/meal-plan',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { date: '2026-05-04', slot: 'dinner', recipeId: 'r-pasta' },
    });
    const id = create.json().id as string;
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/meal-plan/${id}`,
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { recipeId: null, title: 'Takeout' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().recipeId).toBeNull();
    expect(patch.json().title).toBe('Takeout');
  });

  it('sets meal_plan_entry.recipeId to null when the recipe is deleted', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/meal-plan',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { date: '2026-05-04', slot: 'dinner', recipeId: 'r-pasta', title: 'Pasta night' },
    });
    const id = create.json().id as string;
    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/recipes/r-pasta`,
      headers: { cookie: cookieFor('u-jane') },
    });
    expect(del.statusCode).toBe(204);
    const got = await ctx.app.inject({
      method: 'GET',
      url: '/api/meal-plan?weekStart=2026-05-03',
      headers: { cookie: cookieFor('u-jane') },
    });
    const entry = got.json().entries.find((e: { id: string }) => e.id === id);
    expect(entry.recipeId).toBeNull();
    // stored title preserved for historical context
    expect(entry.title).toBe('Pasta night');
  });
});
