import { eq, sql as dsql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DB } from '@home-os/db';
import { schema } from '@home-os/db';
import type { Env } from '../env.js';

const NOW_SQL = dsql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export interface PushSubRow {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function resolveVapidKeys(env: Env): VapidKeys | null {
  const pub = env.HOME_OS_VAPID_PUBLIC_KEY?.trim();
  const priv = env.HOME_OS_VAPID_PRIVATE_KEY?.trim();
  const subj = env.HOME_OS_VAPID_SUBJECT?.trim();
  if (!pub || !priv || !subj) return null;
  return { publicKey: pub, privateKey: priv, subject: subj };
}

/**
 * Upsert a subscription for the current user. The endpoint is unique
 * across the table — if the same endpoint was previously bound to a
 * different user (shared device + user switch), the row is reassigned
 * to the current user so stale deliveries cannot leak across sessions.
 */
export function upsertSubscription(
  db: DB,
  userId: string,
  input: { endpoint: string; p256dh: string; auth: string; userAgent: string | null },
): PushSubRow {
  const id = nanoid(21);
  db.insert(schema.pushSubscriptions)
    .values({
      id,
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent,
    })
    .onConflictDoUpdate({
      target: schema.pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent,
        lastUsedAt: NOW_SQL as unknown as string,
      },
    })
    .run();
  return db
    .select()
    .from(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.endpoint, input.endpoint))
    .get()!;
}

/**
 * Delete a subscription by endpoint but only if it belongs to the
 * requesting user. Returns true iff a row was removed.
 */
export function deleteSubscriptionForUser(db: DB, userId: string, endpoint: string): boolean {
  const row = db
    .select()
    .from(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.endpoint, endpoint))
    .get();
  if (!row || row.userId !== userId) return false;
  db.delete(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.endpoint, endpoint))
    .run();
  return true;
}

export function listSubscriptionsForUsers(db: DB, userIds: string[]): PushSubRow[] {
  if (userIds.length === 0) return [];
  return db
    .select()
    .from(schema.pushSubscriptions)
    .where(dsql`${schema.pushSubscriptions.userId} IN (${dsql.join(userIds, dsql`, `)})`)
    .all();
}

export function deleteSubscriptionByEndpoint(db: DB, endpoint: string): void {
  db.delete(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.endpoint, endpoint))
    .run();
}

// ---------------------------------------------------------------------------
// Web-push dispatcher. The `web-push` module is an optional dependency: we
// lazy-import it so tests + envs without VAPID keys don't need it present.
// ---------------------------------------------------------------------------

export interface PushPayload {
  id: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
}

export interface PushSendResult {
  ok: boolean;
  statusCode?: number;
  removed?: boolean;
  error?: string;
}

export interface PushDispatcher {
  readonly enabled: boolean;
  send(sub: PushSubRow, payload: PushPayload): Promise<PushSendResult>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let webPushModule: any | null = null;
async function loadWebPush() {
  if (webPushModule) return webPushModule;
  try {
    webPushModule = await import('web-push');
    return webPushModule;
  } catch {
    return null;
  }
}

export async function createPushDispatcher(env: Env): Promise<PushDispatcher> {
  const keys = resolveVapidKeys(env);
  if (!keys) {
    return {
      enabled: false,
      async send() {
        return { ok: false, error: 'push_disabled' };
      },
    };
  }
  const mod = await loadWebPush();
  if (!mod) {
    return {
      enabled: false,
      async send() {
        return { ok: false, error: 'web_push_not_installed' };
      },
    };
  }
  const wp = mod.default ?? mod;
  wp.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  return {
    enabled: true,
    async send(sub, payload) {
      try {
        await wp.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
          { TTL: 60 * 60 },
        );
        return { ok: true, statusCode: 201 };
      } catch (err: unknown) {
        const e = err as { statusCode?: number; message?: string };
        const status = typeof e.statusCode === 'number' ? e.statusCode : undefined;
        // 404/410 mean the subscription is gone — permanent; prune.
        const removed = status === 404 || status === 410;
        return {
          ok: false,
          statusCode: status,
          removed,
          error: e.message ?? 'push_error',
        };
      }
    },
  };
}
