import type { FastifyInstance } from 'fastify';
import { schema } from '@home-os/db';
import { requireUser } from '../auth/middleware.js';

/**
 * Household roster — `GET /api/household/members`.
 *
 * Returns every user known to the instance (non-sensitive fields only) so
 * the calendar UI can render per-user color legends and filter toggles.
 * The app is intended for allowlisted household members; it is deliberately
 * NOT a generic user-directory endpoint.
 */
export async function registerHouseholdRoutes(app: FastifyInstance) {
  const { db } = app.deps;
  const auth = requireUser(app);

  app.get('/api/household/members', { preHandler: auth }, async (_req, reply) => {
    const rows = db
      .select({
        id: schema.users.id,
        displayName: schema.users.displayName,
        color: schema.users.color,
        pictureUrl: schema.users.pictureUrl,
      })
      .from(schema.users)
      .orderBy(schema.users.displayName)
      .all();
    return reply.send({ members: rows });
  });
}
