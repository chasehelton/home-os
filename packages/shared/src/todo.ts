import { z } from 'zod';
import { Scope } from './scope.js';

export const Todo = z.object({
  id: z.string().uuid(),
  scope: Scope,
  ownerUserId: z.string().uuid().nullable(),
  title: z.string().min(1).max(500),
  notes: z.string().max(10_000).nullable(),
  dueAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Todo = z.infer<typeof Todo>;

export const CreateTodoInput = Todo.pick({
  scope: true,
  title: true,
  notes: true,
  dueAt: true,
}).extend({
  ownerUserId: z.string().uuid().nullable().optional(),
});
export type CreateTodoInput = z.infer<typeof CreateTodoInput>;

export const UpdateTodoInput = CreateTodoInput.partial().extend({
  completedAt: z.string().datetime().nullable().optional(),
});
export type UpdateTodoInput = z.infer<typeof UpdateTodoInput>;
