import { z } from 'zod';
import { Scope } from './scope.js';

const Id = z.string().min(1).max(64);
const IsoDateTime = z.string().datetime({ offset: true });

export const Todo = z.object({
  id: Id,
  scope: Scope,
  ownerUserId: Id.nullable(),
  title: z.string().min(1).max(500),
  notes: z.string().max(10_000).nullable(),
  dueAt: IsoDateTime.nullable(),
  completedAt: IsoDateTime.nullable(),
  createdBy: Id,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Todo = z.infer<typeof Todo>;

export const CreateTodoInput = z.object({
  scope: Scope,
  title: z.string().min(1).max(500),
  notes: z.string().max(10_000).nullable().optional(),
  dueAt: IsoDateTime.nullable().optional(),
  ownerUserId: Id.nullable().optional(),
});
export type CreateTodoInput = z.infer<typeof CreateTodoInput>;

export const UpdateTodoInput = z
  .object({
    title: z.string().min(1).max(500).optional(),
    notes: z.string().max(10_000).nullable().optional(),
    dueAt: IsoDateTime.nullable().optional(),
    scope: Scope.optional(),
    ownerUserId: Id.nullable().optional(),
    completedAt: IsoDateTime.nullable().optional(),
  })
  .strict();
export type UpdateTodoInput = z.infer<typeof UpdateTodoInput>;

export const ListTodosQuery = z.object({
  scope: z.enum(['household', 'user', 'all']).optional().default('all'),
  includeCompleted: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .default(true)
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true')),
});
export type ListTodosQuery = z.infer<typeof ListTodosQuery>;
