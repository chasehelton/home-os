import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import { openDb, type DB, ensureDataDirs, dataDir as resolveDataDir } from '@home-os/db';
import type Database from 'better-sqlite3';
import { loadEnv, type Env } from './env.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerTodoRoutes } from './routes/todos.js';
import { registerRecipeRoutes } from './routes/recipes.js';
import { registerMealPlanRoutes } from './routes/mealplan.js';

export interface AppDeps {
  env: Env;
  db: DB;
  sqlite: Database.Database;
  dataDir: string;
}

export interface BuildAppOptions {
  env?: Env;
  dataDir?: string;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<{
  app: FastifyInstance;
  deps: AppDeps;
}> {
  const env = options.env ?? loadEnv();
  const dataDir = options.dataDir ?? env.HOME_OS_DATA_DIR ?? resolveDataDir();
  ensureDataDirs(dataDir);
  const { db, sqlite } = openDb({ dataDir });
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

  const deps: AppDeps = { env, db, sqlite, dataDir };
  app.decorate('deps', deps);

  await registerHealthRoutes(app);
  await registerAuthRoutes(app);
  await registerTodoRoutes(app);
  await registerRecipeRoutes(app);
  await registerMealPlanRoutes(app);

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
