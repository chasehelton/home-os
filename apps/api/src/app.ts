import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import { openDb, type DB } from '@home-os/db';
import type Database from 'better-sqlite3';
import { loadEnv, type Env } from './env.js';
import { registerHealthRoutes } from './routes/health.js';

export interface AppDeps {
  env: Env;
  db: DB;
  sqlite: Database.Database;
}

export async function buildApp(env: Env = loadEnv()): Promise<{
  app: FastifyInstance;
  deps: AppDeps;
}> {
  const { db, sqlite } = openDb();
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
    },
    trustProxy: true,
  });

  await app.register(sensible);
  await app.register(cookie, { secret: env.HOME_OS_SESSION_SECRET });
  await app.register(cors, {
    origin: [env.HOME_OS_WEB_ORIGIN],
    credentials: true,
  });

  const deps: AppDeps = { env, db, sqlite };
  app.decorate('deps', deps);

  await registerHealthRoutes(app);

  app.addHook('onClose', async () => {
    sqlite.close();
  });

  return { app, deps };
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}
