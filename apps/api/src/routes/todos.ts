import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CreateTodoInput, ListTodosQuery, UpdateTodoInput } from '@home-os/shared';
import { requireUser } from '../auth/middleware.js';
import { logAudit } from '../auth/audit.js';
import {
  createTodo,
  deleteTodo,
  findTodoById,
  listTodosForUser,
  ScopeError,
  updateTodo,
} from '../todos/repo.js';

export async function registerTodoRoutes(app: FastifyInstance) {
  const auth = requireUser(app);

  app.get('/api/todos', { preHandler: auth }, async (req, reply) => {
    const parsed = ListTodosQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', details: parsed.error.format() });
    }
    const rows = listTodosForUser(app.deps.db, req.user!.id, parsed.data);
    return reply.send({ todos: rows });
  });

  app.post('/api/todos', { preHandler: auth }, async (req, reply) => {
    const parsed = CreateTodoInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.format() });
    }
    try {
      const row = createTodo(app.deps.db, req.user!.id, parsed.data);
      logAudit(app.deps.db, {
        actorUserId: req.user!.id,
        action: 'create',
        entity: 'todo',
        entityId: row.id,
        after: row,
      });
      return reply.code(201).send(row);
    } catch (err) {
      return handleScopeError(err, reply);
    }
  });

  app.patch<{ Params: { id: string } }>(
    '/api/todos/:id',
    { preHandler: auth },
    async (req, reply) => {
      const parsed = UpdateTodoInput.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', details: parsed.error.format() });
      }
      const before = findTodoById(app.deps.db, req.params.id);
      if (!before) return reply.code(404).send({ error: 'not_found' });
      if (!canSee(before, req.user!.id)) return reply.code(404).send({ error: 'not_found' });
      try {
        const row = updateTodo(app.deps.db, req.user!.id, req.params.id, parsed.data);
        if (!row) return reply.code(404).send({ error: 'not_found' });
        logAudit(app.deps.db, {
          actorUserId: req.user!.id,
          action: 'update',
          entity: 'todo',
          entityId: row.id,
          before,
          after: row,
        });
        return reply.send(row);
      } catch (err) {
        return handleScopeError(err, reply);
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/todos/:id',
    { preHandler: auth },
    async (req, reply) => {
      const before = findTodoById(app.deps.db, req.params.id);
      if (!before) return reply.code(404).send({ error: 'not_found' });
      if (!canSee(before, req.user!.id)) return reply.code(404).send({ error: 'not_found' });
      try {
        const row = deleteTodo(app.deps.db, req.user!.id, req.params.id);
        if (!row) return reply.code(404).send({ error: 'not_found' });
        logAudit(app.deps.db, {
          actorUserId: req.user!.id,
          action: 'delete',
          entity: 'todo',
          entityId: row.id,
          before: row,
        });
        return reply.code(204).send();
      } catch (err) {
        return handleScopeError(err, reply);
      }
    },
  );
}

function canSee(row: { scope: string; ownerUserId: string | null }, userId: string) {
  return row.scope === 'household' || row.ownerUserId === userId;
}

function handleScopeError(err: unknown, reply: FastifyReply) {
  if (err instanceof ScopeError) {
    return reply.code(403).send({ error: 'forbidden', message: err.message });
  }
  throw err as Error;
}

// satisfy TS unused-param lint
export type _Req = FastifyRequest;
