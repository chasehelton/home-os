import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/db/src -> repo root
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Resolve the single household data root. Honors HOME_OS_DATA_DIR env;
 * falls back to <repo-root>/.data for dev.
 * On the Pi this is typically /srv/home-os/data (SD) or /mnt/data (USB-SSD).
 */
export function dataDir(): string {
  const fromEnv = process.env.HOME_OS_DATA_DIR;
  if (fromEnv && fromEnv.trim() !== '') return path.resolve(fromEnv);
  return path.join(REPO_ROOT, '.data');
}

export function ensureDataDirs(): string {
  const root = dataDir();
  for (const sub of ['db', 'images', 'litestream', 'backups']) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
  return root;
}

export function dbFilePath(): string {
  return path.join(dataDir(), 'db', 'home-os.sqlite');
}
