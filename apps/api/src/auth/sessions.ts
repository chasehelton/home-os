import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DB } from '@home-os/db';
import { schema } from '@home-os/db';

export const SESSION_COOKIE = 'sid';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface CreateSessionInput {
  userId: string;
  now?: Date;
  ttlMs?: number;
}

export function createSession(db: DB, input: CreateSessionInput): {
  id: string;
  expiresAt: Date;
} {
  const now = input.now ?? new Date();
  const ttl = input.ttlMs ?? SESSION_TTL_MS;
  const expiresAt = new Date(now.getTime() + ttl);
  const id = nanoid(32);
  db.insert(schema.sessions)
    .values({
      id,
      userId: input.userId,
      expiresAt: expiresAt.toISOString(),
    })
    .run();
  return { id, expiresAt };
}

export function lookupSession(
  db: DB,
  sessionId: string,
  now: Date = new Date(),
): { userId: string; expiresAt: Date } | null {
  const row = db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .get();
  if (!row) return null;
  const expiresAt = new Date(row.expiresAt);
  if (expiresAt.getTime() <= now.getTime()) {
    deleteSession(db, sessionId);
    return null;
  }
  return { userId: row.userId, expiresAt };
}

export function deleteSession(db: DB, sessionId: string): void {
  db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId)).run();
}

export function deleteSessionsForUser(db: DB, userId: string): void {
  db.delete(schema.sessions).where(eq(schema.sessions.userId, userId)).run();
}
