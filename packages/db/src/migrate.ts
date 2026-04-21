import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDb } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, '..', 'migrations');

const { db, sqlite } = openDb();
try {
  migrate(db, { migrationsFolder });
  console.log('Migrations applied.');
} finally {
  sqlite.close();
}
