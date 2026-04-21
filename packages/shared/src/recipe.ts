import { z } from 'zod';

const Id = z.string().min(1).max(64);
const IsoDateTime = z.string().datetime({ offset: true });

export const ImportStatus = z.enum(['imported', 'partial', 'manual']);
export type ImportStatus = z.infer<typeof ImportStatus>;

export const RecipeSummary = z.object({
  id: Id,
  sourceUrl: z.string().url().nullable(),
  title: z.string().min(1).max(500),
  description: z.string().max(10_000).nullable(),
  author: z.string().max(200).nullable(),
  siteName: z.string().max(200).nullable(),
  domain: z.string().max(200).nullable(),
  imagePath: z.string().nullable(),
  imageSourceUrl: z.string().url().nullable(),
  importStatus: ImportStatus,
  createdBy: Id,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type RecipeSummary = z.infer<typeof RecipeSummary>;

export const Recipe = RecipeSummary.extend({
  markdown: z.string(),
});
export type Recipe = z.infer<typeof Recipe>;

export const CreateRecipeInput = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10_000).nullable().optional(),
  author: z.string().max(200).nullable().optional(),
  siteName: z.string().max(200).nullable().optional(),
  domain: z.string().max(200).nullable().optional(),
  sourceUrl: z.string().url().nullable().optional(),
  markdown: z.string().max(500_000).default(''),
});
export type CreateRecipeInput = z.infer<typeof CreateRecipeInput>;

export const UpdateRecipeInput = z
  .object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(10_000).nullable().optional(),
    author: z.string().max(200).nullable().optional(),
    siteName: z.string().max(200).nullable().optional(),
    domain: z.string().max(200).nullable().optional(),
    sourceUrl: z.string().url().nullable().optional(),
    markdown: z.string().max(500_000).optional(),
  })
  .strict();
export type UpdateRecipeInput = z.infer<typeof UpdateRecipeInput>;

export const ImportRecipeInput = z.object({
  url: z.string().url(),
});
export type ImportRecipeInput = z.infer<typeof ImportRecipeInput>;

