import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import * as schema from './schema.js';
import { dbFilePath, ensureDataDirs, dataDir, migrationsDir } from './paths.js';

export type DB = BetterSQLite3Database<typeof schema>;

export interface OpenDbOptions {
  dataDir?: string;
}

/**
 * Open the single writer connection. Enforces WAL mode and sensible pragmas
 * for an SD-card-friendly, Litestream-compatible deployment (per plan.md §4a).
 *
 * IMPORTANT: Only ONE process should open this DB for writes.
 */
export function openDb(options: OpenDbOptions = {}): {
  db: DB;
  sqlite: Database.Database;
} {
  const root = options.dataDir ? path.resolve(options.dataDir) : dataDir();
  ensureDataDirs(root);
  const filePath = path.join(root, 'db', 'home-os.sqlite');
  const sqlite = new Database(filePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

/** Apply all pending migrations from packages/db/migrations. */
export function runMigrations(options: OpenDbOptions = {}): void {
  const { db, sqlite } = openDb(options);
  try {
    migrate(db, { migrationsFolder: migrationsDir() });
  } finally {
    sqlite.close();
  }
}

export { schema };
export * from './paths.js';
export { dbFilePath };
export { scanMigrationSql } from './destructive.js';
export type { DestructiveFinding, ScanResult } from './destructive.js';
export { listPendingMigrations } from './pending.js';
export type { PendingMigration } from './pending.js';
export { createSnapshot, defaultSnapshotPath } from './snapshot.js';
export type { SnapshotResult } from './snapshot.js';
