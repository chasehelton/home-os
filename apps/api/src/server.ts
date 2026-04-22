import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { runMigrations } from '@home-os/db';

const env = loadEnv();

// Apply pending migrations on startup. In production set
// HOME_OS_AUTO_MIGRATE=false — scripts/deploy.sh runs the safe path
// (`pnpm --filter=@home-os/db migrate:safe`) which takes a pre-migrate
// snapshot and gates destructive SQL before restarting the service.
if (env.HOME_OS_AUTO_MIGRATE) {
  try {
    runMigrations({ dataDir: env.HOME_OS_DATA_DIR });
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
} else {
  console.log('[home-os] HOME_OS_AUTO_MIGRATE=false — skipping auto-migrate (production flow).');
}

const { app } = await buildApp({ env });

try {
  await app.listen({ host: env.HOME_OS_API_HOST, port: env.HOME_OS_API_PORT });
  app.log.info(`home-os api listening on http://${env.HOME_OS_API_HOST}:${env.HOME_OS_API_PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  });
}
