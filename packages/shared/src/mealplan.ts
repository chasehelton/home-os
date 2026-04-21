import { z } from 'zod';

const Id = z.string().min(1).max(64);
const IsoDateTime = z.string().datetime({ offset: true });
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const MealSlot = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export type MealSlot = z.infer<typeof MealSlot>;

export const MealPlanEntry = z.object({
  id: Id,
  date: IsoDate,
  slot: MealSlot,
  recipeId: Id.nullable(),
  title: z.string().max(500).nullable(),
  notes: z.string().max(10_000).nullable(),
  createdBy: Id,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MealPlanEntry = z.infer<typeof MealPlanEntry>;

/**
 * Either recipeId or title must be present; if both are provided, title is
 * allowed to override the recipe's title (e.g. "Mom's lasagna — double batch").
 */
export const CreateMealPlanEntryInput = z
  .object({
    date: IsoDate,
    slot: MealSlot,
    recipeId: Id.nullable().optional(),
    title: z.string().min(1).max(500).nullable().optional(),
    notes: z.string().max(10_000).nullable().optional(),
  })
  .refine((v) => !!v.recipeId || !!v.title, {
    message: 'either recipeId or title is required',
  });
export type CreateMealPlanEntryInput = z.infer<typeof CreateMealPlanEntryInput>;

export const UpdateMealPlanEntryInput = z
  .object({
    date: IsoDate.optional(),
    slot: MealSlot.optional(),
    recipeId: Id.nullable().optional(),
    title: z.string().min(1).max(500).nullable().optional(),
    notes: z.string().max(10_000).nullable().optional(),
  })
  .strict();
export type UpdateMealPlanEntryInput = z.infer<typeof UpdateMealPlanEntryInput>;

export const ListMealPlanQuery = z.object({
  weekStart: IsoDate.optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
});
export type ListMealPlanQuery = z.infer<typeof ListMealPlanQuery>;
