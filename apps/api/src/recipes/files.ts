import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Stores a recipe's markdown body as a file on disk under
 * <dataDir>/recipes/<id>.md. The DB row is the index / metadata; this module
 * owns the file-system side.
 */
export function recipesDir(dataDir: string): string {
  return path.join(dataDir, 'recipes');
}

export function recipeFilePath(dataDir: string, id: string): string {
  return path.join(recipesDir(dataDir), `${id}.md`);
}

export async function writeRecipeMarkdown(
  dataDir: string,
  id: string,
  markdown: string,
): Promise<void> {
  const dir = recipesDir(dataDir);
  await fs.mkdir(dir, { recursive: true });
  const finalPath = recipeFilePath(dataDir, id);
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, markdown, 'utf8');
  await fs.rename(tmpPath, finalPath);
}

export async function readRecipeMarkdown(dataDir: string, id: string): Promise<string> {
  try {
    return await fs.readFile(recipeFilePath(dataDir, id), 'utf8');
  } catch (err) {
    if (isNotFound(err)) return '';
    throw err as Error;
  }
}

export async function deleteRecipeMarkdown(dataDir: string, id: string): Promise<void> {
  try {
    await fs.unlink(recipeFilePath(dataDir, id));
  } catch (err) {
    if (!isNotFound(err)) throw err as Error;
  }
}

function isNotFound(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT';
}
