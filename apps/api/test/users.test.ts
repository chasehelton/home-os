import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeTestApp } from './_helpers.js';
import { upsertUserFromClaims, findUserBySub, findUserByEmail } from '../src/auth/users.js';

let ctx: Awaited<ReturnType<typeof makeTestApp>>;

beforeEach(async () => {
  ctx = await makeTestApp();
});
afterEach(async () => {
  await ctx.cleanup();
});

const claims = {
  sub: 'g_123',
  email: 'jane@example.com',
  emailVerified: true,
  name: 'Jane Doe',
  pictureUrl: 'https://example.com/jane.png',
};

describe('upsertUserFromClaims', () => {
  it('inserts a new user when neither sub nor email matches', () => {
    const u = upsertUserFromClaims(ctx.deps.db, claims);
    expect(u.googleSub).toBe('g_123');
    expect(u.email).toBe('jane@example.com');
    expect(u.emailVerified).toBe(true);
    expect(findUserBySub(ctx.deps.db, 'g_123')?.id).toBe(u.id);
  });

  it('updates name/picture when the same sub signs in again', () => {
    const a = upsertUserFromClaims(ctx.deps.db, claims);
    const b = upsertUserFromClaims(ctx.deps.db, {
      ...claims,
      name: 'Jane Smith',
      pictureUrl: 'https://example.com/jane2.png',
    });
    expect(b.id).toBe(a.id);
    expect(b.displayName).toBe('Jane Smith');
    expect(b.pictureUrl).toBe('https://example.com/jane2.png');
  });

  it('links to an existing email-only row by attaching the sub', () => {
    // Pre-seeded user without google_sub (e.g., admin allowlist seeding)
    upsertUserFromClaims(ctx.deps.db, { ...claims, sub: 'placeholder' });
    ctx.deps.sqlite
      .prepare('UPDATE users SET google_sub = NULL WHERE email = ?')
      .run('jane@example.com');
    const linked = upsertUserFromClaims(ctx.deps.db, claims);
    expect(linked.googleSub).toBe('g_123');
    expect(findUserByEmail(ctx.deps.db, 'jane@example.com')?.googleSub).toBe('g_123');
  });
});
