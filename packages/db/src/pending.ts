/**
 * Helpers for enumerating which migrations in packages/db/migrations have NOT
 * yet been applied to a given SQLite file. Drizzle's migrator applies journal
 * entries in order and records one row per applied migration in
 * `__drizzle_migrations` (a table in the private `drizzle` schema on sqlite
 * it's just `__drizzle_migrations` in main). So:
 *
 *     applied_count = rows in __drizzle_migrations
 *     pending       = journal entries with idx >= applied_count
 *
 * This is how drizzle's own migrator decides what to run (see
 * drizzle-orm/better-sqlite3/migrator.ts) — we just surface the pending set so
 * the Phase 10 safety gate can scan their SQL before letting them run.
 */

import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

export interface PendingMigration {
  idx: number;
  tag: string;
  path: string;
  sql: string;
}

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

function readJournal(migrationsFolder: string): Journal {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  const raw = fs.readFileSync(journalPath, 'utf8');
  const journal = JSON.parse(raw) as Journal;
  journal.entries.sort((a, b) => a.idx - b.idx);
  return journal;
}

function appliedCount(sqlite: Database.Database): number {
  // Drizzle creates this table lazily on first migrate(). If it doesn't exist
  // yet, nothing has been applied.
  const row = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`)
    .get() as { name: string } | undefined;
  if (!row) return 0;
  const count = sqlite.prepare(`SELECT COUNT(*) AS n FROM __drizzle_migrations`).get() as {
    n: number;
  };
  return count.n ?? 0;
}

/**
 * Enumerate pending migrations for a DB, returning their SQL so callers
 * (e.g. the destructive-migration gate) can inspect them.
 */
export function listPendingMigrations(
  sqlite: Database.Database,
  migrationsFolder: string,
): PendingMigration[] {
  const journal = readJournal(migrationsFolder);
  const applied = appliedCount(sqlite);
  const pending: PendingMigration[] = [];
  for (const entry of journal.entries) {
    if (entry.idx < applied) continue;
    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    const sql = fs.readFileSync(sqlPath, 'utf8');
    pending.push({ idx: entry.idx, tag: entry.tag, path: sqlPath, sql });
  }
  return pending;
}
