import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeTestApp } from './_helpers.js';
import { logAudit } from '../src/auth/audit.js';
import { schema } from '@home-os/db';

let ctx: Awaited<ReturnType<typeof makeTestApp>>;

beforeEach(async () => {
  ctx = await makeTestApp();
});
afterEach(async () => {
  await ctx.cleanup();
});

describe('logAudit', () => {
  it('writes an event row and redacts secret-shaped fields', () => {
    logAudit(ctx.deps.db, {
      actorUserId: null,
      action: 'login.attempt',
      entity: 'auth',
      after: {
        email: 'x@example.com',
        accessToken: 'super-secret',
        nested: { refreshToken: 'r', notSecret: 'ok' },
      },
    });
    const rows = ctx.deps.db.select().from(schema.auditLog).all();
    expect(rows).toHaveLength(1);
    const after = JSON.parse(rows[0]!.afterJson!);
    expect(after.email).toBe('x@example.com');
    expect(after.accessToken).toBe('[redacted]');
    expect(after.nested.refreshToken).toBe('[redacted]');
    expect(after.nested.notSecret).toBe('ok');
  });
});
