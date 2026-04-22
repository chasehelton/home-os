/**
 * Safe SQLite backup helper. Uses better-sqlite3's online backup API, which
 * works even while the WAL writer is live (that's the whole point — it's the
 * same thing `sqlite3 .backup` does under the hood). We use it both as the
 * nightly snapshot target and as the pre-migration safety net.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export interface SnapshotResult {
  srcPath: string;
  destPath: string;
  bytes: number;
}

/**
 * Create a consistent copy of the sqlite DB at `srcPath` into `destPath`.
 * Destination directory is created if missing. Returns basic stats.
 *
 * NOTE: better-sqlite3's `.backup()` is async and works against any database
 * handle; we open a dedicated read-only handle so the caller's writer isn't
 * blocked or closed.
 */
export async function createSnapshot(srcPath: string, destPath: string): Promise<SnapshotResult> {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  if (fs.existsSync(destPath)) {
    fs.rmSync(destPath);
  }
  const src = new Database(srcPath, { readonly: true, fileMustExist: true });
  try {
    await src.backup(destPath);
  } finally {
    src.close();
  }
  const stat = fs.statSync(destPath);
  return { srcPath, destPath, bytes: stat.size };
}

export function defaultSnapshotPath(dataDir: string, label: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeLabel = label.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return path.join(dataDir, 'backups', `${stamp}_${safeLabel}.sqlite`);
}
