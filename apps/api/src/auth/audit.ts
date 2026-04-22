import type { DB } from '@home-os/db';
import { schema } from '@home-os/db';

export interface AuditEvent {
  actorUserId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

const SECRET_KEYS = new Set([
  'pin',
  'pinHash',
  'pin_hash',
  'sessionId',
  'sid',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'idToken',
  'id_token',
  'codeVerifier',
  'code_verifier',
  'state',
  'nonce',
  'password',
  'secret',
  'accessTokenEnc',
  'access_token_enc',
  'refreshTokenEnc',
  'refresh_token_enc',
]);

/** Recursively redact secret-shaped fields before they ever land in the DB. */
function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEYS.has(k) ? '[redacted]' : redact(v);
  }
  return out;
}

export function logAudit(db: DB, event: AuditEvent): void {
  db.insert(schema.auditLog)
    .values({
      actorUserId: event.actorUserId,
      action: event.action,
      entity: event.entity,
      entityId: event.entityId ?? null,
      beforeJson: event.before === undefined ? null : JSON.stringify(redact(event.before)),
      afterJson: event.after === undefined ? null : JSON.stringify(redact(event.after)),
    })
    .run();
}
