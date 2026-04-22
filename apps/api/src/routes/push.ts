import type { FastifyInstance } from 'fastify';
import { PushSubscriptionInput, PushUnsubscribeInput } from '@home-os/shared';
import { requireUser } from '../auth/middleware.js';
import {
  deleteSubscriptionForUser,
  resolveVapidKeys,
  upsertSubscription,
} from '../reminders/push.js';

export async function registerPushRoutes(app: FastifyInstance) {
  const auth = requireUser(app);

  app.get('/api/push/vapid-public-key', async (_req, reply) => {
    const keys = resolveVapidKeys(app.deps.env);
    if (!keys) return reply.code(503).send({ error: 'push_disabled' });
    return reply.send({ publicKey: keys.publicKey });
  });

  app.post('/api/push/subscribe', { preHandler: auth }, async (req, reply) => {
    const parsed = PushSubscriptionInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.format() });
    }
    const row = upsertSubscription(app.deps.db, req.user!.id, {
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      userAgent: parsed.data.userAgent ?? null,
    });
    // Don't echo the subscription keys back to the client.
    return reply.code(201).send({
      id: row.id,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    });
  });

  app.post('/api/push/unsubscribe', { preHandler: auth }, async (req, reply) => {
    const parsed = PushUnsubscribeInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.format() });
    }
    const removed = deleteSubscriptionForUser(
      app.deps.db,
      req.user!.id,
      parsed.data.endpoint,
    );
    return reply.send({ removed });
  });
}
