import { and, asc, eq, gte, lte, sql as dsql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DB } from '@home-os/db';
import { schema } from '@home-os/db';
import type {
  CreateMealPlanEntryInput,
  MealSlot,
  UpdateMealPlanEntryInput,
} from '@home-os/shared';

export interface MealPlanEntryRow {
  id: string;
  date: string;
  slot: MealSlot;
  recipeId: string | null;
  title: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const NOW_SQL = dsql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export function findMealPlanEntryById(db: DB, id: string): MealPlanEntryRow | null {
  return (
    db
      .select()
      .from(schema.mealPlanEntries)
      .where(eq(schema.mealPlanEntries.id, id))
      .get() ?? null
  );
}

export function listMealPlanEntriesBetween(
  db: DB,
  fromDate: string,
  toDate: string
): MealPlanEntryRow[] {
  return db
    .select()
    .from(schema.mealPlanEntries)
    .where(
      and(
        gte(schema.mealPlanEntries.date, fromDate),
        lte(schema.mealPlanEntries.date, toDate)
      )
    )
    .orderBy(
      asc(schema.mealPlanEntries.date),
      dsql`CASE ${schema.mealPlanEntries.slot} WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'dinner' THEN 2 WHEN 'snack' THEN 3 ELSE 4 END`,
      asc(schema.mealPlanEntries.createdAt)
    )
    .all();
}

export function createMealPlanEntry(
  db: DB,
  actorId: string,
  input: CreateMealPlanEntryInput
): MealPlanEntryRow {
  const id = nanoid(21);
  db.insert(schema.mealPlanEntries)
    .values({
      id,
      date: input.date,
      slot: input.slot,
      recipeId: input.recipeId ?? null,
      title: input.title ?? null,
      notes: input.notes ?? null,
      createdBy: actorId,
    })
    .run();
  return findMealPlanEntryById(db, id)!;
}

export function updateMealPlanEntry(
  db: DB,
  id: string,
  patch: UpdateMealPlanEntryInput
): MealPlanEntryRow | null {
  const existing = findMealPlanEntryById(db, id);
  if (!existing) return null;

  const next: Partial<MealPlanEntryRow> = {};
  if (patch.date !== undefined) next.date = patch.date;
  if (patch.slot !== undefined) next.slot = patch.slot;
  if (patch.recipeId !== undefined) next.recipeId = patch.recipeId;
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.notes !== undefined) next.notes = patch.notes;

  db.update(schema.mealPlanEntries)
    .set({ ...next, updatedAt: NOW_SQL as unknown as string })
    .where(eq(schema.mealPlanEntries.id, id))
    .run();
  return findMealPlanEntryById(db, id);
}

export function deleteMealPlanEntry(db: DB, id: string): MealPlanEntryRow | null {
  const existing = findMealPlanEntryById(db, id);
  if (!existing) return null;
  db.delete(schema.mealPlanEntries).where(eq(schema.mealPlanEntries.id, id)).run();
  return existing;
}
