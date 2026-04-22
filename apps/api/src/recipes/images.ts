import fs from 'node:fs/promises';
import path from 'node:path';
import { safeFetch, FetchSafetyError } from './safe-fetch.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export interface DownloadedImage {
  /** Path relative to HOME_OS_DATA_DIR, e.g. 'images/recipes/abc123.jpg'. */
  relativePath: string;
  absolutePath: string;
  contentType: string;
}

/**
 * Downloads a remote image into <dataDir>/images/recipes/<recipeId><ext>.
 * Returns null (never throws) on any failure — import should still succeed
 * without the image.
 */
export async function downloadRecipeImage(
  imageUrl: string,
  dataDir: string,
  recipeId: string,
): Promise<DownloadedImage | null> {
  try {
    const result = await safeFetch(imageUrl, {
      maxBytes: MAX_IMAGE_BYTES,
      timeoutMs: TIMEOUT_MS,
      accept: 'image/*',
    });
    const rawCt = (result.contentType ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
    const ext = ALLOWED_TYPES[rawCt];
    if (!ext) return null;

    const imagesDir = path.join(dataDir, 'images', 'recipes');
    await fs.mkdir(imagesDir, { recursive: true });
    const filename = `${recipeId}${ext}`;
    const absolutePath = path.join(imagesDir, filename);
    await fs.writeFile(absolutePath, result.bytes);
    return {
      relativePath: path.posix.join('images', 'recipes', filename),
      absolutePath,
      contentType: rawCt,
    };
  } catch (err) {
    if (err instanceof FetchSafetyError) return null;
    return null;
  }
}

/** Resolves a relative imagePath against dataDir, rejecting anything that
 *  would escape the images/ directory (defense in depth). */
export function resolveImagePath(dataDir: string, relative: string): string | null {
  const root = path.resolve(path.join(dataDir, 'images'));
  const resolved = path.resolve(path.join(dataDir, relative));
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  return resolved;
}
