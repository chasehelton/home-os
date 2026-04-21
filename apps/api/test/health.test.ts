import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';

const env = {
  HOME_OS_API_HOST: '127.0.0.1',
  HOME_OS_API_PORT: 0,
  HOME_OS_WEB_ORIGIN: 'http://localhost:5173',
  HOME_OS_SESSION_SECRET: 'test-secret-test-secret-test-secret-test-secret',
  HOME_OS_DATA_DIR: '/tmp/home-os-test-data',
  HOME_OS_AI_PROVIDER: 'disabled',
  NODE_ENV: 'test' as const,
};

const { app } = await buildApp(env);

afterAll(async () => {
  await app.close();
});

describe('health', () => {
  it('GET /health/live returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/ready returns ok when db is reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: 'ok' });
  });
});
