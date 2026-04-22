import type { FastifyInstance, FastifyReply } from 'fastify';
import * as client from 'openid-client';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import {
  CalendarEventCreate,
  CalendarEventUpdate,
  ListCalendarEventsQuery,
} from '@home-os/shared';
import { schema } from '@home-os/db';
import { requireUser } from '../auth/middleware.js';
import { logAudit } from '../auth/audit.js';
import { makeTokenCrypto, deriveTokenKey, type TokenCrypto } from '../auth/crypto.js';
import {
  listAccountsForUser,
  listEventsForHouseholdBetween,
  listEventsForUserBetween,
  syncAccount,
  withAccountLock,
  type AccountRow,
  type SyncConfig,
} from '../calendar/sync.js';
import {
  WriteError,
  createLocalEvent,
  deleteLocalEvent,
  pushPendingForAccount,
  resolveWriteContext,
  updateLocalEvent,
} from '../calendar/write.js';

const STATE_COOKIE = 'oidc-cal';
const STATE_TTL_S = 10 * 60;

const StateBlob = z.object({
  state: z.string(),
  nonce: z.string(),
  codeVerifier: z.string(),
});

const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const CAL_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export { hasWriteScope } from './calendar-helpers.js';
import { hasWriteScope } from './calendar-helpers.js';

function isProd(env: { NODE_ENV: string }): boolean {
  return env.NODE_ENV === 'production';
}

function summarizeAccount(a: AccountRow & { calendars: unknown[] }) {
  return {
    id: a.id,
    userId: a.userId,
    email: a.email,
    status: a.status,
    lastError: a.lastError,
    canWrite: hasWriteScope(a.scopes),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    calendars: (a.calendars as Array<{
      id: string;
      googleCalendarId: string;
      summary: string;
      description: string | null;
      backgroundColor: string | null;
      foregroundColor: string | null;
      timeZone: string | null;
      primary: boolean;
      selected: boolean;
      lastFullSyncAt: string | null;
      lastIncrementalSyncAt: string | null;
    }>).map((c) => ({
      id: c.id,
      googleCalendarId: c.googleCalendarId,
      summary: c.summary,
      description: c.description,
      backgroundColor: c.backgroundColor,
      foregroundColor: c.foregroundColor,
      timeZone: c.timeZone,
      primary: c.primary,
      selected: c.selected,
      lastFullSyncAt: c.lastFullSyncAt,
      lastIncrementalSyncAt: c.lastIncrementalSyncAt,
    })),
  };
}

export async function registerCalendarRoutes(app: FastifyInstance) {
  const { env, db } = app.deps;
  const auth = requireUser(app);
  const oauthConfigured = !!(env.HOME_OS_GOOGLE_CLIENT_ID && env.HOME_OS_GOOGLE_CLIENT_SECRET);

  let configPromise: Promise<client.Configuration> | null = null;
  async function getConfig(): Promise<client.Configuration> {
    if (!oauthConfigured) throw new Error('oauth_not_configured');
    if (!configPromise) {
      configPromise = client.discovery(
        new URL('https://accounts.google.com'),
        env.HOME_OS_GOOGLE_CLIENT_ID!,
        env.HOME_OS_GOOGLE_CLIENT_SECRET!
      );
    }
    return configPromise;
  }

  const crypto: TokenCrypto = makeTokenCrypto(deriveTokenKey(env));
  const syncCfg: SyncConfig = {
    clientId: env.HOME_OS_GOOGLE_CLIENT_ID ?? '',
    clientSecret: env.HOME_OS_GOOGLE_CLIENT_SECRET ?? '',
    crypto,
    fetchImpl: app.deps.fetchImpl,
  };
  // Expose crypto + cfg on the app so the worker + tests can pick them up.
  app.decorate('calendarSyncCfg', syncCfg);

  // --- Connect (start the consent flow) -----------------------------------

  app.get('/auth/google/calendar/connect', { preHandler: auth }, async (req, reply) => {
    if (!oauthConfigured) {
      return reply.code(503).send({ error: 'oauth_not_configured' });
    }
    const cfg = await getConfig();
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();
    // Build a calendar-specific redirect URI by swapping the path on the
    // configured login redirect. This keeps one HOME_OS_GOOGLE_REDIRECT_URI
    // env for the base and derives the calendar callback deterministically.
    const redirectUri = env.HOME_OS_GOOGLE_REDIRECT_URI.replace(
      /\/auth\/google\/callback\/?$/,
      '/auth/google/calendar/callback'
    );

    const url = client.buildAuthorizationUrl(cfg, {
      redirect_uri: redirectUri,
      scope: `openid email profile ${CAL_SCOPE} ${CAL_WRITE_SCOPE}`,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      // Pre-select the user's existing Google account so they don't pick
      // the wrong one by accident.
      login_hint: req.user!.email,
    });

    reply.setCookie(STATE_COOKIE, JSON.stringify({ state, nonce, codeVerifier }), {
      path: '/auth/google/calendar',
      httpOnly: true,
      secure: isProd(env),
      sameSite: 'lax',
      signed: true,
      maxAge: STATE_TTL_S,
    });
    return reply.redirect(url.toString());
  });

  // --- Callback (exchange + store encrypted refresh token) ----------------

  app.get('/auth/google/calendar/callback', { preHandler: auth }, async (req, reply) => {
    if (!oauthConfigured) {
      return reply.code(503).send({ error: 'oauth_not_configured' });
    }
    const raw = req.cookies[STATE_COOKIE];
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
    reply.clearCookie(STATE_COOKIE, { path: '/auth/google/calendar' });

    const cfg = await getConfig();
    const redirectUri = env.HOME_OS_GOOGLE_REDIRECT_URI.replace(
      /\/auth\/google\/callback\/?$/,
      '/auth/google/calendar/callback'
    );
    const callbackUrl = new URL(
      `${redirectUri}${req.url.replace('/auth/google/calendar/callback', '')}`
    );

    let tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers;
    try {
      tokens = await client.authorizationCodeGrant(cfg, callbackUrl, {
        pkceCodeVerifier: parsed.codeVerifier,
        expectedState: parsed.state,
        expectedNonce: parsed.nonce,
      });
    } catch (err) {
      req.log.warn({ err }, 'calendar oauth exchange failed');
      return reply.code(400).send({ error: 'oauth_exchange_failed' });
    }

    const claims = tokens.claims();
    const refreshToken =
      typeof (tokens as { refresh_token?: unknown }).refresh_token === 'string'
        ? ((tokens as { refresh_token: string }).refresh_token)
        : null;
    if (!claims || !refreshToken) {
      return reply.code(400).send({ error: 'missing_refresh_token' });
    }

    const grantedSub = String(claims.sub);
    const grantedEmail = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    const scope =
      typeof (tokens as { scope?: unknown }).scope === 'string'
        ? ((tokens as { scope: string }).scope)
        : CAL_SCOPE;

    // Safety: calendar account MUST bind to the currently logged-in user's
    // Google identity. Otherwise a household member could attach the other
    // member's calendar to their own app account.
    const me = req.user!;
    if (!me.googleSub || me.googleSub !== grantedSub) {
      logAudit(db, {
        actorUserId: me.id,
        action: 'calendar.connect.rejected.sub_mismatch',
        entity: 'calendar_account',
        after: { grantedEmail },
      });
      return reply.code(403).send({ error: 'google_account_mismatch' });
    }

    const sealed = crypto.seal(refreshToken);

    const existing = db
      .select()
      .from(schema.calendarAccounts)
      .where(eq(schema.calendarAccounts.googleSub, grantedSub))
      .get();

    let accountId: string;
    if (existing) {
      accountId = existing.id;
      db.update(schema.calendarAccounts)
        .set({
          userId: me.id,
          email: grantedEmail || existing.email,
          refreshTokenEnc: sealed,
          scopes: scope,
          status: 'active',
          lastError: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.calendarAccounts.id, existing.id))
        .run();
    } else {
      accountId = nanoid(21);
      db.insert(schema.calendarAccounts)
        .values({
          id: accountId,
          userId: me.id,
          googleSub: grantedSub,
          email: grantedEmail || me.email,
          refreshTokenEnc: sealed,
          scopes: scope,
          status: 'active',
        })
        .run();
    }
    logAudit(db, {
      actorUserId: me.id,
      action: existing ? 'calendar.connect.refresh' : 'calendar.connect',
      entity: 'calendar_account',
      entityId: accountId,
      after: { email: grantedEmail, scopes: scope },
    });

    // Fire-and-forget initial sync so the user sees events right away.
    const account = db
      .select()
      .from(schema.calendarAccounts)
      .where(eq(schema.calendarAccounts.id, accountId))
      .get() as AccountRow | undefined;
    if (account) {
      setImmediate(() => {
        void withAccountLock(accountId, () => syncAccount(db, account, syncCfg)).catch(
          (err) => req.log.warn({ err }, 'initial calendar sync failed')
        );
      });
    }

    const returnTo = `${env.HOME_OS_WEB_ORIGIN.replace(/\/$/, '')}/?tab=settings`;
    return reply.redirect(returnTo);
  });

  // --- JSON API -----------------------------------------------------------

  app.get('/api/calendar/accounts', { preHandler: auth }, async (req, reply) => {
    const rows = listAccountsForUser(db, req.user!.id);
    return reply.send({ accounts: rows.map(summarizeAccount) });
  });

  app.delete<{ Params: { id: string } }>(
    '/api/calendar/accounts/:id',
    { preHandler: auth },
    async (req, reply) => {
      const existing = db
        .select()
        .from(schema.calendarAccounts)
        .where(
          and(
            eq(schema.calendarAccounts.id, req.params.id),
            eq(schema.calendarAccounts.userId, req.user!.id)
          )
        )
        .get();
      if (!existing) return reply.code(404).send({ error: 'not_found' });
      // Acquire the account lock first so we don't race an in-flight tick.
      await withAccountLock(existing.id, async () => {
        db.delete(schema.calendarAccounts)
          .where(eq(schema.calendarAccounts.id, existing.id))
          .run();
      });
      logAudit(db, {
        actorUserId: req.user!.id,
        action: 'calendar.disconnect',
        entity: 'calendar_account',
        entityId: existing.id,
        before: { email: existing.email },
      });
      return reply.code(204).send();
    }
  );

  app.post('/api/calendar/sync', { preHandler: auth }, async (req, reply) => {
    const accounts = db
      .select()
      .from(schema.calendarAccounts)
      .where(
        and(
          eq(schema.calendarAccounts.userId, req.user!.id),
          eq(schema.calendarAccounts.status, 'active')
        )
      )
      .all() as AccountRow[];
    const results = [];
    for (const a of accounts) {
      try {
        const r = await withAccountLock(a.id, () => syncAccount(db, a, syncCfg));
        results.push(r);
      } catch (err) {
        results.push({ accountId: a.id, error: (err as Error).message });
      }
    }
    return reply.send({ results });
  });

  app.get('/api/calendar/events', { preHandler: auth }, async (req, reply) => {
    const parsed = ListCalendarEventsQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', details: parsed.error.format() });
    }
    const { from, to, scope } = parsed.data;
    if (scope === 'household') {
      const rows = listEventsForHouseholdBetween(db, from, to);
      return reply.send({ from, to, scope, events: rows });
    }
    const rows = listEventsForUserBetween(db, req.user!.id, from, to);
    return reply.send({ from, to, scope, events: rows });
  });

  // --- Phase 7: Write routes ---------------------------------------------

  type Reply = FastifyReply;

  function mapWriteError(err: WriteError, reply: Reply) {
    switch (err.code) {
      case 'not_found':
        return reply.code(404).send({ error: 'not_found' });
      case 'recurring_edit_unsupported':
        return reply.code(409).send({ error: 'recurring_edit_unsupported' });
      case 'not_primary_calendar':
        return reply.code(403).send({ error: 'not_primary_calendar' });
      case 'invalid_times':
        return reply.code(400).send({ error: 'invalid_times', message: err.message });
      case 'write_scope_missing':
        return reply.code(403).send({ error: 'write_scope_missing' });
      case 'conflict':
        return reply.code(409).send({ error: 'conflict' });
    }
  }

  function requireWriteScope(account: AccountRow, reply: Reply) {
    if (!hasWriteScope(account.scopes)) {
      reply.code(403).send({ error: 'write_scope_missing' });
      return false;
    }
    return true;
  }

  async function pushInline(accountId: string) {
    const acc = db
      .select()
      .from(schema.calendarAccounts)
      .where(eq(schema.calendarAccounts.id, accountId))
      .get() as AccountRow | undefined;
    if (!acc) return;
    await withAccountLock(acc.id, () => pushPendingForAccount(db, acc, syncCfg));
  }

  app.post('/api/calendar/events', { preHandler: auth }, async (req, reply) => {
    const parsed = CalendarEventCreate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.format() });
    }
    let accountId: string;
    try {
      const ctx = resolveWriteContext(db, req.user!.id, parsed.data.calendarListId);
      if (!requireWriteScope(ctx.account, reply)) return;
      accountId = ctx.account.id;
    } catch (err) {
      if (err instanceof WriteError) return mapWriteError(err, reply);
      throw err;
    }
    let row;
    try {
      row = createLocalEvent(db, req.user!.id, parsed.data);
    } catch (err) {
      if (err instanceof WriteError) return mapWriteError(err, reply);
      throw err;
    }
    try {
      await pushInline(accountId);
    } catch (err) {
      req.log.warn({ err }, 'calendar push after create failed');
    }
    const fresh = db
      .select()
      .from(schema.calendarEvents)
      .where(eq(schema.calendarEvents.id, row.id))
      .get();
    return reply.code(201).send({ event: fresh });
  });

  app.patch<{ Params: { id: string } }>(
    '/api/calendar/events/:id',
    { preHandler: auth },
    async (req, reply) => {
      const parsed = CalendarEventUpdate.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', details: parsed.error.format() });
      }
      // Scope check up front: look up the event's account.
      const existing = db
        .select({ event: schema.calendarEvents, list: schema.calendarLists, account: schema.calendarAccounts })
        .from(schema.calendarEvents)
        .innerJoin(
          schema.calendarLists,
          eq(schema.calendarEvents.calendarListId, schema.calendarLists.id)
        )
        .innerJoin(
          schema.calendarAccounts,
          eq(schema.calendarLists.accountId, schema.calendarAccounts.id)
        )
        .where(eq(schema.calendarEvents.id, req.params.id))
        .get();
      if (!existing || existing.account.userId !== req.user!.id) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (!requireWriteScope(existing.account as AccountRow, reply)) return;
      let row;
      try {
        row = updateLocalEvent(db, req.user!.id, req.params.id, parsed.data);
      } catch (err) {
        if (err instanceof WriteError) return mapWriteError(err, reply);
        throw err;
      }
      try {
        await pushInline(existing.account.id);
      } catch (err) {
        req.log.warn({ err }, 'calendar push after update failed');
      }
      const fresh = db
        .select()
        .from(schema.calendarEvents)
        .where(eq(schema.calendarEvents.id, row.id))
        .get();
      if (fresh?.conflictPayload) {
        return reply.code(409).send({ error: 'conflict', event: fresh });
      }
      return reply.send({ event: fresh });
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/api/calendar/events/:id',
    { preHandler: auth },
    async (req, reply) => {
      const existing = db
        .select({ event: schema.calendarEvents, list: schema.calendarLists, account: schema.calendarAccounts })
        .from(schema.calendarEvents)
        .innerJoin(
          schema.calendarLists,
          eq(schema.calendarEvents.calendarListId, schema.calendarLists.id)
        )
        .innerJoin(
          schema.calendarAccounts,
          eq(schema.calendarLists.accountId, schema.calendarAccounts.id)
        )
        .where(eq(schema.calendarEvents.id, req.params.id))
        .get();
      if (!existing || existing.account.userId !== req.user!.id) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (!requireWriteScope(existing.account as AccountRow, reply)) return;
      try {
        deleteLocalEvent(db, req.user!.id, req.params.id);
      } catch (err) {
        if (err instanceof WriteError) return mapWriteError(err, reply);
        throw err;
      }
      try {
        await pushInline(existing.account.id);
      } catch (err) {
        req.log.warn({ err }, 'calendar push after delete failed');
      }
      return reply.code(204).send();
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/calendar/events/:id/discard-conflict',
    { preHandler: auth },
    async (req, reply) => {
      const existing = db
        .select({ event: schema.calendarEvents, list: schema.calendarLists, account: schema.calendarAccounts })
        .from(schema.calendarEvents)
        .innerJoin(
          schema.calendarLists,
          eq(schema.calendarEvents.calendarListId, schema.calendarLists.id)
        )
        .innerJoin(
          schema.calendarAccounts,
          eq(schema.calendarLists.accountId, schema.calendarAccounts.id)
        )
        .where(eq(schema.calendarEvents.id, req.params.id))
        .get();
      if (!existing || existing.account.userId !== req.user!.id) {
        return reply.code(404).send({ error: 'not_found' });
      }
      db.update(schema.calendarEvents)
        .set({ conflictPayload: null, lastPushError: null, updatedAt: new Date().toISOString() })
        .where(eq(schema.calendarEvents.id, req.params.id))
        .run();
      logAudit(db, {
        actorUserId: req.user!.id,
        action: 'calendar.event.conflict.discarded',
        entity: 'calendar_event',
        entityId: req.params.id,
      });
      return reply.code(204).send();
    }
  );
}

declare module 'fastify' {
  interface FastifyInstance {
    calendarSyncCfg: SyncConfig;
  }
}
