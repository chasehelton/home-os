import { eq, desc, sql as dsql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DB } from '@home-os/db';
import { schema } from '@home-os/db';
import type { CreateRecipeInput, UpdateRecipeInput, ImportStatus } from '@home-os/shared';

export interface RecipeRow {
  id: string;
  sourceUrl: string | null;
  title: string;
  description: string | null;
  author: string | null;
  siteName: string | null;
  domain: string | null;
  imagePath: string | null;
  imageSourceUrl: string | null;
  importStatus: ImportStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const NOW_SQL = dsql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export function findRecipeById(db: DB, id: string): RecipeRow | null {
  return db.select().from(schema.recipes).where(eq(schema.recipes.id, id)).get() ?? null;
}

export function listRecipes(db: DB): RecipeRow[] {
  return db
    .select()
    .from(schema.recipes)
    .orderBy(desc(schema.recipes.updatedAt))
    .all();
}

export function createRecipeRow(
  db: DB,
  actorId: string,
  input: Omit<CreateRecipeInput, 'markdown'>,
  opts: {
    importStatus: ImportStatus;
    imagePath?: string | null;
    imageSourceUrl?: string | null;
    id?: string;
  }
): RecipeRow {
  const id = opts.id ?? nanoid(21);
  db.insert(schema.recipes)
    .values({
      id,
      sourceUrl: input.sourceUrl ?? null,
      title: input.title,
      description: input.description ?? null,
      author: input.author ?? null,
      siteName: input.siteName ?? null,
      domain: input.domain ?? null,
      imagePath: opts.imagePath ?? null,
      imageSourceUrl: opts.imageSourceUrl ?? null,
      importStatus: opts.importStatus,
      createdBy: actorId,
    })
    .run();
  return findRecipeById(db, id)!;
}

export function updateRecipeRow(
  db: DB,
  id: string,
  patch: Omit<UpdateRecipeInput, 'markdown'>
): RecipeRow | null {
  const existing = findRecipeById(db, id);
  if (!existing) return null;
  const next: Partial<RecipeRow> = {};
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.author !== undefined) next.author = patch.author;
  if (patch.siteName !== undefined) next.siteName = patch.siteName;
  if (patch.domain !== undefined) next.domain = patch.domain;
  if (patch.sourceUrl !== undefined) next.sourceUrl = patch.sourceUrl;

  // Any manual edit of a partial import promotes it out of "partial".
  if (existing.importStatus === 'partial') next.importStatus = 'manual';

  db.update(schema.recipes)
    .set({ ...next, updatedAt: NOW_SQL as unknown as string })
    .where(eq(schema.recipes.id, id))
    .run();
  return findRecipeById(db, id);
}

export function touchRecipe(db: DB, id: string): void {
  db.update(schema.recipes)
    .set({ updatedAt: NOW_SQL as unknown as string })
    .where(eq(schema.recipes.id, id))
    .run();
}

export function deleteRecipeRow(db: DB, id: string): RecipeRow | null {
  const existing = findRecipeById(db, id);
  if (!existing) return null;
  db.delete(schema.recipes).where(eq(schema.recipes.id, id)).run();
  return existing;
}
