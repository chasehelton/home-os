import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { dbFilePath, ensureDataDirs } from './paths.js';

export type DB = BetterSQLite3Database<typeof schema>;

/**
 * Open the single writer connection. Enforces WAL mode and sensible pragmas
 * for an SD-card-friendly, Litestream-compatible deployment (per plan.md §4a).
 *
 * IMPORTANT: Only ONE process should open this DB for writes. Other services
 * (Litestream, backup scripts) read it out-of-band via its own file handle.
 */
export function openDb(filePath: string = dbFilePath()): {
  db: DB;
  sqlite: Database.Database;
} {
  ensureDataDirs();
  const sqlite = new Database(filePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export { schema };
export * from './paths.js';
