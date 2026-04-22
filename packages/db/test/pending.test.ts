import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { listPendingMigrations } from '../src/pending.js';

const migrationsFolder = path.join(__dirname, '..', 'migrations');

describe('listPendingMigrations', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'home-os-pend-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('lists all migrations when the DB is empty', () => {
    const db = new Database(path.join(tmp, 'empty.sqlite'));
    try {
      const pending = listPendingMigrations(db, migrationsFolder);
      // Use >= so adding new migrations later doesn't break this test.
      expect(pending.length).toBeGreaterThanOrEqual(8);
      expect(pending[0].tag).toBe('0000_chemical_fixer');
      for (const p of pending) {
        expect(p.sql.length).toBeGreaterThan(0);
      }
    } finally {
      db.close();
    }
  });

  it('lists zero pending after running all migrations', () => {
    const dbPath = path.join(tmp, 'migrated.sqlite');
    const sqlite = new Database(dbPath);
    try {
      sqlite.pragma('journal_mode = WAL');
      sqlite.pragma('foreign_keys = ON');
      const d = drizzle(sqlite);
      migrate(d, { migrationsFolder });
      const pending = listPendingMigrations(sqlite, migrationsFolder);
      expect(pending).toEqual([]);
    } finally {
      sqlite.close();
    }
  });
});
