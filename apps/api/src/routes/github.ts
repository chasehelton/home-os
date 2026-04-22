import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { requireUser } from '../auth/middleware.js';
import {
  deleteGithubAccount,
  getGithubAccountPublic,
  upsertGithubAccount,
} from '../github/accounts.js';
import {
  fetchGithubUser,
  pollAccessToken,
  requestDeviceCode,
} from '../github/deviceFlow.js';

// In-memory map of pending device codes, keyed per-user. Device codes are
// short-lived (expires_in ~15 min) and single-use, so a process-local map is
// sufficient — no point persisting them. If the process restarts, the user
// just hits "Connect GitHub" again.
interface PendingDevice {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
}

function makePendingMap() {
  const map = new Map<string, PendingDevice>();
  return {
    set(userId: string, p: PendingDevice) {
      map.set(userId, p);
    },
    get(userId: string): PendingDevice | undefined {
      const p = map.get(userId);
      if (!p) return undefined;
      if (p.expiresAt < Date.now()) {
        map.delete(userId);
        return undefined;
      }
      return p;
    },
    delete(userId: string) {
      map.delete(userId);
    },
  };
}

const PollBody = z.object({}).optional();

export async function registerGithubRoutes(app: FastifyInstance) {
  const auth = requireUser(app);
  const { env, db } = app.deps;
  const pending = makePendingMap();
  const fetchImpl = app.deps.fetchImpl ?? fetch;

  app.get('/api/github/status', { preHandler: auth }, async (req, reply) => {
    const acc = getGithubAccountPublic(db, req.user!.id);
    const hasPending = !!pending.get(req.user!.id);
    return reply.send({
      connected: !!acc,
      clientId: env.HOME_OS_GITHUB_CLIENT_ID,
      account: acc
        ? {
            githubLogin: acc.githubLogin,
            githubUserId: acc.githubUserId,
            scopes: acc.scopes,
            status: acc.status,
            createdAt: acc.createdAt,
          }
        : null,
      pendingAuthorization: hasPending,
    });
  });

  app.post('/api/github/device/start', { preHandler: auth }, async (req, reply) => {
    try {
      const r = await requestDeviceCode({
        clientId: env.HOME_OS_GITHUB_CLIENT_ID,
        fetchImpl,
      });
      pending.set(req.user!.id, {
        deviceCode: r.device_code,
        userCode: r.user_code,
        verificationUri: r.verification_uri,
        expiresAt: Date.now() + r.expires_in * 1000,
        interval: r.interval,
      });
      // Never return device_code to the client; it's held server-side and
      // the client just polls /device/poll.
      return reply.send({
        userCode: r.user_code,
        verificationUri: r.verification_uri,
        expiresIn: r.expires_in,
        interval: r.interval,
      });
    } catch (err) {
      req.log.warn({ err }, 'github device_code failed');
      return reply
        .code(502)
        .send({ error: 'github_device_code_failed', message: (err as Error).message });
    }
  });

  app.post('/api/github/device/poll', { preHandler: auth }, async (req, reply) => {
    PollBody.parse(req.body ?? {});
    const p = pending.get(req.user!.id);
    if (!p) {
      return reply.code(404).send({ error: 'no_pending_authorization' });
    }
    const result = await pollAccessToken({
      clientId: env.HOME_OS_GITHUB_CLIENT_ID,
      deviceCode: p.deviceCode,
      fetchImpl,
    });
    if (result.kind === 'pending') {
      if (result.interval && result.interval !== p.interval) {
        p.interval = result.interval;
      }
      return reply.send({
        status: 'pending',
        reason: result.reason,
        interval: p.interval,
      });
    }
    if (result.kind === 'error') {
      pending.delete(req.user!.id);
      return reply.code(400).send({
        status: 'error',
        error: result.reason,
        description: result.description ?? null,
      });
    }
    // Success — look up the GitHub user for display, store the token.
    try {
      const who = await fetchGithubUser(result.accessToken, fetchImpl);
      upsertGithubAccount(env, db, {
        id: nanoid(21),
        userId: req.user!.id,
        githubUserId: who.id,
        githubLogin: who.login,
        accessToken: result.accessToken,
        scopes: result.scope,
      });
      pending.delete(req.user!.id);
      return reply.send({
        status: 'ok',
        account: { githubLogin: who.login, githubUserId: who.id, scopes: result.scope },
      });
    } catch (err) {
      req.log.warn({ err }, 'github user lookup failed after device-flow success');
      pending.delete(req.user!.id);
      return reply
        .code(502)
        .send({ status: 'error', error: 'user_lookup_failed', description: (err as Error).message });
    }
  });

  app.delete('/api/github/account', { preHandler: auth }, async (req, reply) => {
    deleteGithubAccount(db, req.user!.id);
    pending.delete(req.user!.id);
    return reply.send({ ok: true });
  });
}
