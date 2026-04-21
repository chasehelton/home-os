import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { lookupSession, SESSION_COOKIE } from './sessions.js';
import { findUserById, type UserRow } from './users.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserRow;
  }
}

/**
 * Reads the signed `sid` cookie, validates the session row, and attaches
 * `req.user`. Replies 401 if missing/expired/unknown. Use as a route preHandler
 * (or a route-prefix hook) for everything that requires identity.
 */
export function requireUser(app: FastifyInstance) {
  return async function handler(req: FastifyRequest, reply: FastifyReply) {
    const cookie = req.cookies[SESSION_COOKIE];
    if (!cookie) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const unsigned = req.unsignCookie(cookie);
    if (!unsigned.valid || !unsigned.value) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const session = lookupSession(app.deps.db, unsigned.value);
    if (!session) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const user = findUserById(app.deps.db, session.userId);
    if (!user) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    req.user = user;
  };
}
