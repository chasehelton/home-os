import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { nanoid } from 'nanoid';
import { runMigrations } from '@home-os/db';
import { buildApp } from '../src/app.js';
import type { Env } from '../src/env.js';

export function makeTestEnv(over: Partial<Env> = {}): Env {
  return {
    HOME_OS_API_HOST: '127.0.0.1',
    HOME_OS_API_PORT: 0,
    HOME_OS_WEB_ORIGIN: 'http://localhost:5173',
    HOME_OS_SESSION_SECRET: 'test-secret-test-secret-test-secret-test-secret',
    HOME_OS_GOOGLE_REDIRECT_URI: 'http://localhost:4000/auth/google/callback',
    HOME_OS_ALLOWED_EMAILS: '',
    HOME_OS_AI_PROVIDER: 'disabled',
    HOME_OS_OPENAI_MODEL: 'gpt-4o-mini',
    HOME_OS_OPENAI_BASE_URL: 'https://api.openai.com',
    HOME_OS_GITHUB_CLIENT_ID: 'Iv1.test-client-id',
    HOME_OS_COPILOT_MODEL: 'gpt-4o-mini',
    HOME_OS_COPILOT_BASE_URL: 'https://api.githubcopilot.com',
    HOME_OS_CALENDAR_SYNC_INTERVAL_MS: 5 * 60 * 1000,
    NODE_ENV: 'test' as const,
    ...over,
  };
}

export async function makeTestApp(over: Partial<Env> = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `home-os-test-${nanoid(6)}-`));
  runMigrations({ dataDir });
  const env = makeTestEnv(over);
  const { app, deps } = await buildApp({ env, dataDir });
  return {
    app,
    deps,
    dataDir,
    cleanup: async () => {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
