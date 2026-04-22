#!/usr/bin/env node
/**
 * Phase 10 migration safety gate (CLI).
 *
 * Runs the same migrate() that `pnpm db:migrate` runs, but with two
 * safeguards:
 *
 *   1. **Snapshot before migrate.** Always writes a `sqlite3 .backup`-style
 *      copy into `<dataDir>/backups/` before touching the DB. If migrate
 *      fails or is interrupted, point the DB file at the snapshot to recover.
 *
 *   2. **Destructive-migration gate.** Scans *pending* migrations (ones not
 *      yet in `__drizzle_migrations`) for `DROP TABLE`, `ALTER ... DROP
 *      COLUMN`, or drizzle's recreate-table pattern. If any pending migration
 *      is destructive, refuses to run unless either:
 *        - `HOME_OS_ALLOW_DESTRUCTIVE_MIGRATIONS=1` is set, or
 *        - `--allow-destructive` is passed.
 *
 * Called by scripts/deploy.sh (production) and directly via
 * `pnpm --filter=@home-os/db migrate:safe`. Dev/test paths use
 * runMigrations() (no snapshot, no gate).
 * `migrate` one-shot service. In dev, `pnpm db:migrate` bypasses this gate
 * (see packages/db/src/migrate.ts) because the dev DB is disposable.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createSnapshot, defaultSnapshotPath } from './snapshot.js';
import { listPendingMigrations } from './pending.js';
import { scanMigrationSql } from './destructive.js';
import { dataDir as resolveDataDir, dbFilePath, migrationsDir } from './paths.js';
import { runMigrations } from './index.js';
import Database from 'better-sqlite3';

interface Options {
  allowDestructive: boolean;
  skipSnapshot: boolean;
  dryRun: boolean;
  dataDir: string;
}

function parseArgs(argv: string[]): Options {
  const allowDestructiveEnv =
    process.env.HOME_OS_ALLOW_DESTRUCTIVE_MIGRATIONS === '1' ||
    process.env.HOME_OS_ALLOW_DESTRUCTIVE_MIGRATIONS === 'true';
  const opts: Options = {
    allowDestructive: allowDestructiveEnv,
    skipSnapshot: false,
    dryRun: false,
    dataDir: process.env.HOME_OS_DATA_DIR
      ? path.resolve(process.env.HOME_OS_DATA_DIR)
      : resolveDataDir(),
  };
  for (const arg of argv) {
    if (arg === '--allow-destructive') opts.allowDestructive = true;
    else if (arg === '--skip-snapshot') opts.skipSnapshot = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(2);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`Usage: migrate-safe [options]

  --allow-destructive   Permit DROP TABLE / DROP COLUMN / recreate in pending migrations.
                        Also enabled by HOME_OS_ALLOW_DESTRUCTIVE_MIGRATIONS=1.
  --skip-snapshot       Don't take a pre-migration snapshot (not recommended).
  --dry-run             Report pending + destructive findings, don't apply.
  -h, --help            Show this help.

Reads HOME_OS_DATA_DIR (default ./.data).`);
}

export async function runSafeMigration(options: Options): Promise<number> {
  const dbPath = dbFilePath(options.dataDir);
  const migrations = migrationsDir();

  // Inspect what's pending BEFORE we touch anything.
  // The DB file may not exist yet on a totally fresh deployment.
  let pending: ReturnType<typeof listPendingMigrations> = [];
  if (fs.existsSync(dbPath)) {
    const sqlite = new Database(dbPath, { readonly: true });
    try {
      pending = listPendingMigrations(sqlite, migrations);
    } finally {
      sqlite.close();
    }
  } else {
    // First-run: all entries are pending.
    const tmp = new Database(':memory:');
    try {
      pending = listPendingMigrations(tmp, migrations);
    } finally {
      tmp.close();
    }
  }

  console.log(`[migrate-safe] ${pending.length} pending migration(s).`);
  const destructive: { tag: string; reasons: string[] }[] = [];
  for (const m of pending) {
    const result = scanMigrationSql(m.sql);
    if (result.destructive) {
      destructive.push({
        tag: m.tag,
        reasons: result.findings.map((f) => `${f.kind}: ${f.detail}`),
      });
    }
    console.log(`  - ${m.tag}${result.destructive ? '  ⚠ destructive' : ''}`);
  }

  if (destructive.length > 0) {
    console.log('');
    console.log('[migrate-safe] Destructive migrations detected:');
    for (const d of destructive) {
      console.log(`  ${d.tag}`);
      for (const r of d.reasons) console.log(`    - ${r}`);
    }
    if (!options.allowDestructive) {
      console.error('');
      console.error(
        '[migrate-safe] Refusing to proceed. Re-run with HOME_OS_ALLOW_DESTRUCTIVE_MIGRATIONS=1',
      );
      console.error('[migrate-safe] or pass --allow-destructive after confirming data safety.');
      return 3;
    }
    console.log('[migrate-safe] --allow-destructive set; proceeding.');
  }

  if (options.dryRun) {
    console.log('[migrate-safe] --dry-run: stopping before snapshot+migrate.');
    return 0;
  }

  if (pending.length === 0) {
    console.log('[migrate-safe] Nothing to do.');
    return 0;
  }

  if (!options.skipSnapshot && fs.existsSync(dbPath)) {
    const dest = defaultSnapshotPath(options.dataDir, 'pre-migrate');
    console.log(`[migrate-safe] Snapshot → ${dest}`);
    const res = await createSnapshot(dbPath, dest);
    console.log(`[migrate-safe] Snapshot OK (${res.bytes} bytes).`);
  } else if (!fs.existsSync(dbPath)) {
    console.log('[migrate-safe] No existing DB file; skipping snapshot.');
  }

  console.log('[migrate-safe] Running migrations…');
  runMigrations({ dataDir: options.dataDir });
  console.log('[migrate-safe] Migrations applied.');
  return 0;
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const opts = parseArgs(process.argv.slice(2));
  runSafeMigration(opts).then((code) => process.exit(code));
}
