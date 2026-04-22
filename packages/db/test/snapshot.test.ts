import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createSnapshot, defaultSnapshotPath } from '../src/snapshot.js';

describe('createSnapshot', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'home-os-snap-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('copies an active WAL database to a consistent destination', async () => {
    const src = path.join(tmp, 'home-os.sqlite');
    const db = new Database(src);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    const insert = db.prepare('INSERT INTO t (v) VALUES (?)');
    for (let i = 0; i < 100; i++) insert.run(`row-${i}`);
    db.close();

    const dest = path.join(tmp, 'out', 'snap.sqlite');
    const r = await createSnapshot(src, dest);
    expect(r.destPath).toBe(dest);
    expect(r.bytes).toBeGreaterThan(0);
    expect(fs.existsSync(dest)).toBe(true);

    const copy = new Database(dest, { readonly: true });
    const n = copy.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number };
    expect(n.n).toBe(100);
    copy.close();
  });

  it('overwrites an existing snapshot file', async () => {
    const src = path.join(tmp, 'src.sqlite');
    new Database(src).close();
    const dest = path.join(tmp, 'dest.sqlite');
    fs.writeFileSync(dest, 'not a sqlite file');

    await createSnapshot(src, dest);
    // Should be a real sqlite DB now (no throw on open).
    const copy = new Database(dest, { readonly: true });
    expect(copy.open).toBe(true);
    copy.close();
  });
});

describe('defaultSnapshotPath', () => {
  it('places snapshots under <dataDir>/backups with a safe timestamped name', () => {
    const p = defaultSnapshotPath('/data', 'pre-migrate');
    expect(p.startsWith('/data/backups/')).toBe(true);
    expect(p.endsWith('_pre-migrate.sqlite')).toBe(true);
    expect(path.basename(p)).not.toMatch(/[:]/);
  });

  it('sanitizes the label', () => {
    const p = defaultSnapshotPath('/data', 'weird label / with bad chars');
    expect(path.basename(p)).not.toMatch(/[/ ]/);
  });
});
