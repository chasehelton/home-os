import type { FastifyInstance } from 'fastify';
import {
  CreateMealPlanEntryInput,
  ListMealPlanQuery,
  UpdateMealPlanEntryInput,
} from '@home-os/shared';
import { requireUser } from '../auth/middleware.js';
import { logAudit } from '../auth/audit.js';
import {
  createMealPlanEntry,
  deleteMealPlanEntry,
  findMealPlanEntryById,
  listMealPlanEntriesBetween,
  updateMealPlanEntry,
} from '../mealplan/repo.js';

/**
 * Compute the ISO date (YYYY-MM-DD) that is `days` after `startYmd`.
 * Uses UTC math to be DST-agnostic; dates themselves are calendar dates,
 * not timestamps.
 */
function addDaysYmd(startYmd: string, days: number): string {
  const [y, m, d] = startYmd.split('-').map(Number);
  const t = Date.UTC(y!, m! - 1, d! + days);
  const dt = new Date(t);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

function todayYmd(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

export async function registerMealPlanRoutes(app: FastifyInstance) {
  const auth = requireUser(app);

  // GET /api/meal-plan — returns entries for a date range.
  // Accepts either `weekStart` (returns 7 days from that date) or explicit
  // `from`/`to` bounds. Defaults to the 7-day window starting today.
  app.get('/api/meal-plan', { preHandler: auth }, async (req, reply) => {
    const parsed = ListMealPlanQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', details: parsed.error.format() });
    }
    let from: string;
    let to: string;
    if (parsed.data.weekStart) {
      from = parsed.data.weekStart;
      to = addDaysYmd(from, 6);
    } else if (parsed.data.from && parsed.data.to) {
      from = parsed.data.from;
      to = parsed.data.to;
    } else if (parsed.data.from) {
      from = parsed.data.from;
      to = addDaysYmd(from, 6);
    } else {
      from = todayYmd();
      to = addDaysYmd(from, 6);
    }
    const rows = listMealPlanEntriesBetween(app.deps.db, from, to);
    return reply.send({ from, to, entries: rows });
  });

  // GET /api/meal-plan/tonight — convenience for the kiosk home.
  // Returns today's dinner (if planned) or null.
  app.get('/api/meal-plan/tonight', { preHandler: auth }, async (_req, reply) => {
    const today = todayYmd();
    const rows = listMealPlanEntriesBetween(app.deps.db, today, today);
    const dinner = rows.find((r) => r.slot === 'dinner') ?? null;
    return reply.send({ date: today, dinner });
  });

  app.post('/api/meal-plan', { preHandler: auth }, async (req, reply) => {
    const parsed = CreateMealPlanEntryInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.format() });
    }
    const row = createMealPlanEntry(app.deps.db, req.user!.id, parsed.data);
    logAudit(app.deps.db, {
      actorUserId: req.user!.id,
      action: 'create',
      entity: 'meal_plan_entry',
      entityId: row.id,
      after: row,
    });
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>(
    '/api/meal-plan/:id',
    { preHandler: auth },
    async (req, reply) => {
      const parsed = UpdateMealPlanEntryInput.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', details: parsed.error.format() });
      }
      const before = findMealPlanEntryById(app.deps.db, req.params.id);
      if (!before) return reply.code(404).send({ error: 'not_found' });
      const row = updateMealPlanEntry(app.deps.db, req.params.id, parsed.data);
      if (!row) return reply.code(404).send({ error: 'not_found' });
      logAudit(app.deps.db, {
        actorUserId: req.user!.id,
        action: 'update',
        entity: 'meal_plan_entry',
        entityId: row.id,
        before,
        after: row,
      });
      return reply.send(row);
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/api/meal-plan/:id',
    { preHandler: auth },
    async (req, reply) => {
      const row = deleteMealPlanEntry(app.deps.db, req.params.id);
      if (!row) return reply.code(404).send({ error: 'not_found' });
      logAudit(app.deps.db, {
        actorUserId: req.user!.id,
        action: 'delete',
        entity: 'meal_plan_entry',
        entityId: row.id,
        before: row,
      });
      return reply.code(204).send();
    }
  );
}
