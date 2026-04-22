import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import { existsSync, statSync } from 'node:fs';
import { resolve as resolvePath, join as joinPath } from 'node:path';
import { openDb, type DB, ensureDataDirs, dataDir as resolveDataDir } from '@home-os/db';
import type Database from 'better-sqlite3';
import { loadEnv, type Env } from './env.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerTodoRoutes } from './routes/todos.js';
import { registerRecipeRoutes } from './routes/recipes.js';
import { registerMealPlanRoutes } from './routes/mealplan.js';
import { registerCalendarRoutes } from './routes/calendar.js';
import { registerHouseholdRoutes } from './routes/household.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerGithubRoutes } from './routes/github.js';
import { registerReminderRoutes } from './routes/reminders.js';
import { registerPushRoutes } from './routes/push.js';
import { startCalendarWorker, type CalendarWorker } from './calendar/worker.js';
import { createPushDispatcher } from './reminders/push.js';
import { startReminderWorker, type ReminderWorker } from './reminders/worker.js';

export interface AppDeps {
  env: Env;
  db: DB;
  sqlite: Database.Database;
  dataDir: string;
  /** Optional fetch override; tests inject a mock here. */
  fetchImpl?: typeof fetch;
}

export interface BuildAppOptions {
  env?: Env;
  dataDir?: string;
  /** Optional fetch override; tests inject a mock here. */
  fetchImpl?: typeof fetch;
  /** If true, skip starting the background calendar worker. Default off in tests. */
  startWorkers?: boolean;
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

  const deps: AppDeps = { env, db, sqlite, dataDir, fetchImpl: options.fetchImpl };
  app.decorate('deps', deps);

  await registerHealthRoutes(app);
  await registerAuthRoutes(app);
  await registerTodoRoutes(app);
  await registerRecipeRoutes(app);
  await registerMealPlanRoutes(app);
  await registerCalendarRoutes(app);
  await registerHouseholdRoutes(app);
  await registerAiRoutes(app);
  await registerGithubRoutes(app);
  await registerReminderRoutes(app);
  await registerPushRoutes(app);

  // Serve the built web SPA when HOME_OS_WEB_STATIC_DIR is set. API routes
  // above take precedence; anything else falls back to index.html so
  // client-side routing works.
  if (env.HOME_OS_WEB_STATIC_DIR) {
    const staticDir = resolvePath(env.HOME_OS_WEB_STATIC_DIR);
    if (existsSync(staticDir) && statSync(staticDir).isDirectory()) {
      await app.register(fastifyStatic, {
        root: staticDir,
        prefix: '/',
        wildcard: false,
        index: ['index.html'],
      });
      const indexHtml = joinPath(staticDir, 'index.html');
      app.setNotFoundHandler((req, reply) => {
        const url = req.raw.url ?? '/';
        if (
          url.startsWith('/api/') ||
          url.startsWith('/auth/') ||
          url.startsWith('/health/')
        ) {
          return reply.code(404).send({ error: 'not found' });
        }
        return reply.sendFile('index.html', staticDir);
      });
      app.log.info({ staticDir, indexHtml }, 'serving web SPA from static dir');
    } else {
      app.log.warn({ staticDir }, 'HOME_OS_WEB_STATIC_DIR does not exist — skipping SPA serving');
    }
  }

  const shouldStartWorkers = options.startWorkers ?? env.NODE_ENV !== 'test';
  let worker: CalendarWorker | null = null;
  let reminderWorker: ReminderWorker | null = null;
  if (shouldStartWorkers) {
    worker = startCalendarWorker({
      db,
      cfg: app.calendarSyncCfg,
      intervalMs: env.HOME_OS_CALENDAR_SYNC_INTERVAL_MS,
      logger: {
        info: (msg, obj) => app.log.info(obj ?? {}, msg),
        warn: (msg, obj) => app.log.warn(obj ?? {}, msg),
      },
    });
    const dispatcher = await createPushDispatcher(env);
    if (!dispatcher.enabled) {
      app.log.info(
        'reminders: push disabled (VAPID keys not configured or web-push not installed)',
      );
    }
    reminderWorker = startReminderWorker({
      db,
      dispatcher,
      intervalMs: env.HOME_OS_REMINDER_TICK_MS,
      logger: {
        info: (msg, obj) => app.log.info(obj ?? {}, msg),
        warn: (msg, obj) => app.log.warn(obj ?? {}, msg),
      },
    });
  }

  app.addHook('onClose', async () => {
    worker?.stop();
    reminderWorker?.stop();
    sqlite.close();
  });

  return { app, deps };
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}
