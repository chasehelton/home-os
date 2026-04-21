import { and, desc, eq, or, sql as dsql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DB } from '@home-os/db';
import { schema } from '@home-os/db';
import type { CreateTodoInput, UpdateTodoInput, ListTodosQuery } from '@home-os/shared';

export interface TodoRow {
  id: string;
  scope: 'household' | 'user';
  ownerUserId: string | null;
  title: string;
  notes: string | null;
  dueAt: string | null;
  completedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const NOW_SQL = dsql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export function findTodoById(db: DB, id: string): TodoRow | null {
  return db.select().from(schema.todos).where(eq(schema.todos.id, id)).get() ?? null;
}

/**
 * Visibility rule (Phase 2):
 * - household-scoped todos are visible to every authenticated user.
 * - user-scoped todos are visible only to their owner.
 */
export function listTodosForUser(
  db: DB,
  userId: string,
  query: ListTodosQuery
): TodoRow[] {
  const visible = or(
    eq(schema.todos.scope, 'household'),
    and(eq(schema.todos.scope, 'user'), eq(schema.todos.ownerUserId, userId))
  );

  let scopeFilter;
  if (query.scope === 'household') {
    scopeFilter = eq(schema.todos.scope, 'household');
  } else if (query.scope === 'user') {
    scopeFilter = and(eq(schema.todos.scope, 'user'), eq(schema.todos.ownerUserId, userId));
  } else {
    scopeFilter = visible;
  }

  const completedFilter = query.includeCompleted
    ? undefined
    : dsql`${schema.todos.completedAt} IS NULL`;

  const where = completedFilter ? and(scopeFilter, completedFilter) : scopeFilter;

  return db
    .select()
    .from(schema.todos)
    .where(where)
    .orderBy(
      dsql`CASE WHEN ${schema.todos.completedAt} IS NULL THEN 0 ELSE 1 END`,
      dsql`CASE WHEN ${schema.todos.dueAt} IS NULL THEN 1 ELSE 0 END`,
      schema.todos.dueAt,
      desc(schema.todos.createdAt)
    )
    .all();
}

export function createTodo(
  db: DB,
  actorId: string,
  input: CreateTodoInput
): TodoRow {
  let ownerUserId: string | null;
  if (input.scope === 'household') {
    ownerUserId = null;
  } else {
    const requested = input.ownerUserId ?? actorId;
    if (requested !== actorId) {
      throw new ScopeError('cannot create user-scoped todo for another user');
    }
    ownerUserId = actorId;
  }

  const id = nanoid(21);
  db.insert(schema.todos)
    .values({
      id,
      scope: input.scope,
      ownerUserId,
      title: input.title,
      notes: input.notes ?? null,
      dueAt: input.dueAt ?? null,
      createdBy: actorId,
    })
    .run();
  return findTodoById(db, id)!;
}

export function updateTodo(
  db: DB,
  actorId: string,
  id: string,
  patch: UpdateTodoInput
): TodoRow | null {
  const existing = findTodoById(db, id);
  if (!existing) return null;
  assertCanEdit(existing, actorId);

  const next: Partial<TodoRow> = {};
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.notes !== undefined) next.notes = patch.notes;
  if (patch.dueAt !== undefined) next.dueAt = patch.dueAt;
  if (patch.completedAt !== undefined) next.completedAt = patch.completedAt;

  if (patch.scope !== undefined) {
    if (patch.scope === 'household') {
      next.scope = 'household';
      next.ownerUserId = null;
    } else {
      next.scope = 'user';
      const requested = patch.ownerUserId ?? existing.ownerUserId ?? actorId;
      if (requested !== actorId) {
        throw new ScopeError('cannot reassign user-scoped todo to another user');
      }
      next.ownerUserId = actorId;
    }
  } else if (patch.ownerUserId !== undefined && existing.scope === 'user') {
    if (patch.ownerUserId !== actorId) {
      throw new ScopeError('cannot reassign user-scoped todo to another user');
    }
    next.ownerUserId = actorId;
  }

  db.update(schema.todos)
    .set({ ...next, updatedAt: NOW_SQL as unknown as string })
    .where(eq(schema.todos.id, id))
    .run();
  return findTodoById(db, id);
}

export function deleteTodo(db: DB, actorId: string, id: string): TodoRow | null {
  const existing = findTodoById(db, id);
  if (!existing) return null;
  assertCanEdit(existing, actorId);
  db.delete(schema.todos).where(eq(schema.todos.id, id)).run();
  return existing;
}

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeError';
  }
}

function assertCanEdit(row: TodoRow, actorId: string) {
  if (row.scope === 'household') return;
  if (row.ownerUserId !== actorId) {
    throw new ScopeError("cannot modify another user's todo");
  }
}
