import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeTestApp } from './_helpers.js';
import {
  createSession,
  lookupSession,
  deleteSession,
  deleteSessionsForUser,
} from '../src/auth/sessions.js';
import { schema } from '@home-os/db';

let ctx: Awaited<ReturnType<typeof makeTestApp>>;

beforeEach(async () => {
  ctx = await makeTestApp();
  ctx.deps.db
    .insert(schema.users)
    .values({
      id: 'user_a',
      email: 'a@example.com',
      emailVerified: true,
      displayName: 'Alice',
      googleSub: 'g_alice',
    })
    .run();
});
afterEach(async () => {
  await ctx.cleanup();
});

describe('sessions', () => {
  it('creates and looks up a session', () => {
    const { id } = createSession(ctx.deps.db, { userId: 'user_a' });
    const found = lookupSession(ctx.deps.db, id);
    expect(found?.userId).toBe('user_a');
  });

  it('returns null for an expired session and removes it', () => {
    const past = new Date(Date.now() - 60_000);
    const { id } = createSession(ctx.deps.db, {
      userId: 'user_a',
      now: new Date(past.getTime() - 60_000),
      ttlMs: 30_000, // expired before `past`
    });
    expect(lookupSession(ctx.deps.db, id, past)).toBeNull();
    // expired sessions are deleted lazily on lookup
    expect(lookupSession(ctx.deps.db, id, past)).toBeNull();
  });

  it('returns null for an unknown session id', () => {
    expect(lookupSession(ctx.deps.db, 'nope')).toBeNull();
  });

  it('deletes a session explicitly', () => {
    const { id } = createSession(ctx.deps.db, { userId: 'user_a' });
    deleteSession(ctx.deps.db, id);
    expect(lookupSession(ctx.deps.db, id)).toBeNull();
  });

  it('deletes all sessions for a user', () => {
    const a = createSession(ctx.deps.db, { userId: 'user_a' });
    const b = createSession(ctx.deps.db, { userId: 'user_a' });
    deleteSessionsForUser(ctx.deps.db, 'user_a');
    expect(lookupSession(ctx.deps.db, a.id)).toBeNull();
    expect(lookupSession(ctx.deps.db, b.id)).toBeNull();
  });
});
