import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  CreateReminderInput,
  ListRemindersQuery,
  UpdateReminderInput,
} from '@home-os/shared';
import { requireUser } from '../auth/middleware.js';
import { logAudit } from '../auth/audit.js';
import {
  createReminder,
  deleteReminder,
  dismissReminder,
  findReminderById,
  listActiveRemindersForUser,
  listRemindersForUser,
  ScopeError,
  updateReminder,
} from '../reminders/repo.js';

export async function registerReminderRoutes(app: FastifyInstance) {
  const auth = requireUser(app);

  app.get('/api/reminders', { preHandler: auth }, async (req, reply) => {
    const parsed = ListRemindersQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', details: parsed.error.format() });
    }
    const rows = listRemindersForUser(app.deps.db, req.user!.id, parsed.data);
    return reply.send({ reminders: rows });
  });

  app.get('/api/reminders/active', { preHandler: auth }, async (req, reply) => {
    const rows = listActiveRemindersForUser(app.deps.db, req.user!.id);
    return reply.send({ reminders: rows });
  });

  app.post('/api/reminders', { preHandler: auth }, async (req, reply) => {
    const parsed = CreateReminderInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.format() });
    }
    try {
      const row = createReminder(app.deps.db, req.user!.id, parsed.data);
      logAudit(app.deps.db, {
        actorUserId: req.user!.id,
        action: 'create',
        entity: 'reminder',
        entityId: row.id,
        after: row,
      });
      return reply.code(201).send(row);
    } catch (err) {
      return handleScopeError(err, reply);
    }
  });

  app.patch<{ Params: { id: string } }>(
    '/api/reminders/:id',
    { preHandler: auth },
    async (req, reply) => {
      const parsed = UpdateReminderInput.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', details: parsed.error.format() });
      }
      const before = findReminderById(app.deps.db, req.params.id);
      if (!before || !canSee(before, req.user!.id)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      try {
        const row = updateReminder(app.deps.db, req.user!.id, req.params.id, parsed.data);
        if (!row) return reply.code(404).send({ error: 'not_found' });
        logAudit(app.deps.db, {
          actorUserId: req.user!.id,
          action: 'update',
          entity: 'reminder',
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
    '/api/reminders/:id',
    { preHandler: auth },
    async (req, reply) => {
      const before = findReminderById(app.deps.db, req.params.id);
      if (!before || !canSee(before, req.user!.id)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      try {
        const row = deleteReminder(app.deps.db, req.user!.id, req.params.id);
        if (!row) return reply.code(404).send({ error: 'not_found' });
        logAudit(app.deps.db, {
          actorUserId: req.user!.id,
          action: 'delete',
          entity: 'reminder',
          entityId: row.id,
          before: row,
        });
        return reply.code(204).send();
      } catch (err) {
        return handleScopeError(err, reply);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/reminders/:id/dismiss',
    { preHandler: auth },
    async (req, reply) => {
      const before = findReminderById(app.deps.db, req.params.id);
      if (!before || !canSee(before, req.user!.id)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      try {
        const row = dismissReminder(app.deps.db, req.user!.id, req.params.id);
        if (!row) return reply.code(404).send({ error: 'not_found' });
        logAudit(app.deps.db, {
          actorUserId: req.user!.id,
          action: 'dismiss',
          entity: 'reminder',
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
