import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { GoogleOidc, OidcDisabledError } from '../auth/oidc.js';
import { allowedEmails } from '../env.js';
import { createSession, deleteSession, SESSION_COOKIE, SESSION_TTL_MS } from '../auth/sessions.js';
import { upsertUserFromClaims, findUserByEmail, type UserRow } from '../auth/users.js';
import { logAudit } from '../auth/audit.js';
import { requireUser } from '../auth/middleware.js';
import { schema } from '@home-os/db';

const OIDC_STATE_COOKIE = 'oidc';
const OIDC_STATE_TTL_S = 10 * 60;

const StateBlob = z.object({
  state: z.string(),
  nonce: z.string(),
  codeVerifier: z.string(),
});

function isProd(env: { NODE_ENV: string }): boolean {
  return env.NODE_ENV === 'production';
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const { env, db } = app.deps;
  const oidc = new GoogleOidc(env);
  const allowlist = allowedEmails(env);

  app.get('/auth/google/login', async (req, reply) => {
    if (!oidc.isConfigured()) {
      return reply.code(503).send({ error: 'oauth_not_configured' });
    }
    try {
      const { url, codeVerifier, state, nonce } = await oidc.start();
      const blob = JSON.stringify({ state, nonce, codeVerifier });
      reply.setCookie(OIDC_STATE_COOKIE, blob, {
        path: '/auth/google',
        httpOnly: true,
        secure: isProd(env),
        sameSite: 'lax',
        signed: true,
        maxAge: OIDC_STATE_TTL_S,
      });
      return reply.redirect(url.toString());
    } catch (err) {
      req.log.error({ err }, 'oidc start failed');
      return reply.code(500).send({ error: 'oauth_start_failed' });
    }
  });

  app.get('/auth/google/callback', async (req, reply) => {
    const raw = req.cookies[OIDC_STATE_COOKIE];
    if (!raw) return reply.code(400).send({ error: 'missing_state_cookie' });
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) {
      return reply.code(400).send({ error: 'bad_state_cookie' });
    }
    let parsed: z.infer<typeof StateBlob>;
    try {
      parsed = StateBlob.parse(JSON.parse(unsigned.value));
    } catch {
      return reply.code(400).send({ error: 'bad_state_cookie' });
    }
    reply.clearCookie(OIDC_STATE_COOKIE, { path: '/auth/google' });

    const callbackUrl = new URL(
      `${env.HOME_OS_GOOGLE_REDIRECT_URI.replace(/\/$/, '')}${req.url.replace(
        '/auth/google/callback',
        '',
      )}`,
    );

    let claims;
    try {
      claims = await oidc.finish({
        callbackUrl,
        expectedState: parsed.state,
        expectedNonce: parsed.nonce,
        codeVerifier: parsed.codeVerifier,
      });
    } catch (err) {
      if (err instanceof OidcDisabledError) {
        return reply.code(503).send({ error: 'oauth_not_configured' });
      }
      req.log.warn({ err }, 'oidc callback failed');
      return reply.code(400).send({ error: 'oauth_exchange_failed' });
    }

    if (!claims.emailVerified) {
      logAudit(db, {
        actorUserId: null,
        action: 'login.rejected.email_not_verified',
        entity: 'auth',
        after: { email: claims.email },
      });
      return reply.code(403).send({ error: 'email_not_verified' });
    }
    if (!allowlist.has(claims.email)) {
      logAudit(db, {
        actorUserId: null,
        action: 'login.rejected.not_allowlisted',
        entity: 'auth',
        after: { email: claims.email },
      });
      return reply.code(403).send({ error: 'not_allowlisted' });
    }

    const user = upsertUserFromClaims(db, claims);
    const { id: sessionId, expiresAt } = createSession(db, { userId: user.id });

    reply.setCookie(SESSION_COOKIE, sessionId, {
      path: '/',
      httpOnly: true,
      secure: isProd(env),
      sameSite: 'lax',
      signed: true,
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
      expires: expiresAt,
    });

    logAudit(db, {
      actorUserId: user.id,
      action: 'login.success',
      entity: 'auth',
      entityId: user.id,
    });

    return reply.redirect(env.HOME_OS_WEB_ORIGIN);
  });

  app.post('/auth/logout', async (req, reply) => {
    const cookie = req.cookies[SESSION_COOKIE];
    if (cookie) {
      const unsigned = req.unsignCookie(cookie);
      if (unsigned.valid && unsigned.value) {
        deleteSession(db, unsigned.value);
      }
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', { preHandler: requireUser(app) }, async (req) => {
    const u = req.user!;
    return {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      pictureUrl: u.pictureUrl,
      color: u.color,
    };
  });

  // -----------------------------------------------------------------
  // Kiosk device login
  //
  // Google refuses OAuth inside embedded browsers (our Electron kiosk),
  // so the Pi authenticates via a long-lived bearer secret stored in
  // its systemd env. The secret maps to a single pre-configured user
  // email (HOME_OS_KIOSK_USER_EMAIL), which must already be in the
  // allowlist. The user row is auto-created on first call so the kiosk
  // can come up standalone before any human Google login.
  //
  // Sessions minted here are tagged auth_method='kiosk' so they can be
  // revoked separately if the token is rotated.
  // -----------------------------------------------------------------
  app.post('/auth/kiosk', async (req, reply) => {
    const token = env.HOME_OS_KIOSK_TOKEN;
    const email = env.HOME_OS_KIOSK_USER_EMAIL?.toLowerCase();
    if (!token || !email) {
      return reply.code(503).send({ error: 'kiosk_auth_not_configured' });
    }

    const presented = extractBearer(req.headers.authorization);
    if (!presented || !constantTimeEqual(presented, token)) {
      logAudit(db, {
        actorUserId: null,
        action: 'login.kiosk.rejected.bad_token',
        entity: 'auth',
      });
      return reply.code(401).send({ error: 'invalid_kiosk_token' });
    }

    if (!allowlist.has(email)) {
      // Misconfiguration, not an attacker. Don't expose detail to the caller.
      req.log.error(
        { email },
        'HOME_OS_KIOSK_USER_EMAIL is not in HOME_OS_ALLOWED_EMAILS',
      );
      logAudit(db, {
        actorUserId: null,
        action: 'login.kiosk.rejected.not_allowlisted',
        entity: 'auth',
        after: { email },
      });
      return reply.code(500).send({ error: 'kiosk_user_not_allowlisted' });
    }

    let user = findUserByEmail(db, email);
    if (!user) {
      user = createKioskUser(db, email);
      logAudit(db, {
        actorUserId: user.id,
        action: 'user.created.kiosk',
        entity: 'user',
        entityId: user.id,
        after: { email },
      });
    }

    const { id: sessionId, expiresAt } = createSession(db, {
      userId: user.id,
      authMethod: 'kiosk',
    });

    reply.setCookie(SESSION_COOKIE, sessionId, {
      path: '/',
      httpOnly: true,
      secure: isProd(env),
      sameSite: 'lax',
      signed: true,
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
      expires: expiresAt,
    });

    logAudit(db, {
      actorUserId: user.id,
      action: 'login.kiosk.success',
      entity: 'auth',
      entityId: user.id,
    });

    return reply.code(200).send({ ok: true });
  });
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m || !m[1]) return null;
  return m[1].trim();
}

// timingSafeEqual throws on length mismatch; pre-check length and return
// a constant-time inequality so callers can't distinguish length from
// content differences.
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Compare against self so we still spend ~the same time.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

function createKioskUser(
  db: FastifyInstance['deps']['db'],
  email: string,
): UserRow {
  const id = nanoid(21);
  const local = email.split('@')[0] || 'kiosk';
  const displayName = local.charAt(0).toUpperCase() + local.slice(1);
  db.insert(schema.users)
    .values({
      id,
      googleSub: null,
      email,
      emailVerified: true,
      displayName,
    })
    .run();
  const row = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
  if (!row) throw new Error('failed to create kiosk user');
  return row as UserRow;
}
