import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { makeTestApp } from './_helpers.js';

let ctx: Awaited<ReturnType<typeof makeTestApp>>;

beforeAll(async () => {
  ctx = await makeTestApp();
});
afterAll(async () => {
  await ctx.cleanup();
});

describe('health', () => {
  it('GET /health/live returns ok', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/ready returns ok when db is reachable', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: 'ok' });
  });
});
