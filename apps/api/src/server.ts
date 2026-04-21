import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { runMigrations } from '@home-os/db';

const env = loadEnv();

// Apply pending migrations on startup. In production this is gated by
// scripts/migrate-with-snapshot.sh (Phase 10) which takes a backup first.
try {
  runMigrations({ dataDir: env.HOME_OS_DATA_DIR });
} catch (err) {
  console.error('Migration failed:', err);
  process.exit(1);
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
