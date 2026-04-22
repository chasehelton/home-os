import { and, desc, eq, or, sql as dsql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DB } from '@home-os/db';
import { schema } from '@home-os/db';
import type {
  CreateReminderInput,
  UpdateReminderInput,
  ListRemindersQuery,
} from '@home-os/shared';

export interface ReminderRow {
  id: string;
  scope: 'household' | 'user';
  ownerUserId: string | null;
  title: string;
  body: string | null;
  fireAt: string;
  status: 'pending' | 'fired' | 'dismissed' | 'cancelled';
  entityType: 'todo' | 'calendar_event' | 'custom' | null;
  entityId: string | null;
  firedAt: string | null;
  dismissedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const NOW_SQL = dsql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeError';
  }
}

export function findReminderById(db: DB, id: string): ReminderRow | null {
  return db.select().from(schema.reminders).where(eq(schema.reminders.id, id)).get() ?? null;
}

/**
 * Visibility: household reminders are visible to everyone; user reminders
 * only to their owner. Matches the todos visibility rule.
 */
export function listRemindersForUser(
  db: DB,
  userId: string,
  query: ListRemindersQuery,
): ReminderRow[] {
  const visible = or(
    eq(schema.reminders.scope, 'household'),
    and(eq(schema.reminders.scope, 'user'), eq(schema.reminders.ownerUserId, userId)),
  );

  let scopeFilter;
  if (query.scope === 'household') {
    scopeFilter = eq(schema.reminders.scope, 'household');
  } else if (query.scope === 'user') {
    scopeFilter = and(
      eq(schema.reminders.scope, 'user'),
      eq(schema.reminders.ownerUserId, userId),
    );
  } else {
    scopeFilter = visible;
  }

  const filters = [scopeFilter];
  if (query.status) {
    filters.push(eq(schema.reminders.status, query.status));
  } else if (!query.includeDismissed) {
    filters.push(dsql`${schema.reminders.status} != 'dismissed'`);
  }

  return db
    .select()
    .from(schema.reminders)
    .where(and(...filters))
    .orderBy(schema.reminders.fireAt, desc(schema.reminders.createdAt))
    .all();
}

/**
 * Active reminders for the current user: status='fired' AND not dismissed,
 * visible under the normal scope rules. Used by the banner poll.
 */
export function listActiveRemindersForUser(db: DB, userId: string): ReminderRow[] {
  const visible = or(
    eq(schema.reminders.scope, 'household'),
    and(eq(schema.reminders.scope, 'user'), eq(schema.reminders.ownerUserId, userId)),
  );
  return db
    .select()
    .from(schema.reminders)
    .where(and(eq(schema.reminders.status, 'fired'), visible))
    .orderBy(desc(schema.reminders.firedAt))
    .all();
}

export function createReminder(
  db: DB,
  actorId: string,
  input: CreateReminderInput,
): ReminderRow {
  let ownerUserId: string | null;
  if (input.scope === 'household') {
    ownerUserId = null;
  } else {
    const requested = input.ownerUserId ?? actorId;
    if (requested !== actorId) {
      throw new ScopeError('cannot create user-scoped reminder for another user');
    }
    ownerUserId = actorId;
  }
  const id = nanoid(21);
  db.insert(schema.reminders)
    .values({
      id,
      scope: input.scope,
      ownerUserId,
      title: input.title,
      body: input.body ?? null,
      fireAt: input.fireAt,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      createdBy: actorId,
    })
    .run();
  return findReminderById(db, id)!;
}

function assertCanEdit(row: ReminderRow, actorId: string) {
  if (row.scope === 'household') return;
  if (row.ownerUserId !== actorId) {
    throw new ScopeError("cannot modify another user's reminder");
  }
}

export function updateReminder(
  db: DB,
  actorId: string,
  id: string,
  patch: UpdateReminderInput,
): ReminderRow | null {
  const existing = findReminderById(db, id);
  if (!existing) return null;
  assertCanEdit(existing, actorId);

  const next: Partial<ReminderRow> = {};
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.body !== undefined) next.body = patch.body;
  if (patch.fireAt !== undefined) next.fireAt = patch.fireAt;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.scope !== undefined) {
    if (patch.scope === 'household') {
      next.scope = 'household';
      next.ownerUserId = null;
    } else {
      next.scope = 'user';
      const requested = patch.ownerUserId ?? existing.ownerUserId ?? actorId;
      if (requested !== actorId) {
        throw new ScopeError('cannot reassign user-scoped reminder to another user');
      }
      next.ownerUserId = actorId;
    }
  }

  db.update(schema.reminders)
    .set({ ...next, updatedAt: NOW_SQL as unknown as string })
    .where(eq(schema.reminders.id, id))
    .run();
  return findReminderById(db, id);
}

export function deleteReminder(db: DB, actorId: string, id: string): ReminderRow | null {
  const existing = findReminderById(db, id);
  if (!existing) return null;
  assertCanEdit(existing, actorId);
  db.delete(schema.reminders).where(eq(schema.reminders.id, id)).run();
  return existing;
}

export function dismissReminder(db: DB, actorId: string, id: string): ReminderRow | null {
  const existing = findReminderById(db, id);
  if (!existing) return null;
  // Anyone who can see the reminder can dismiss it — household reminders
  // should be dismissable by either user; user-scoped ones only by owner.
  if (existing.scope === 'user' && existing.ownerUserId !== actorId) {
    throw new ScopeError("cannot dismiss another user's reminder");
  }
  db.update(schema.reminders)
    .set({
      status: 'dismissed',
      dismissedAt: NOW_SQL as unknown as string,
      updatedAt: NOW_SQL as unknown as string,
    })
    .where(eq(schema.reminders.id, id))
    .run();
  return findReminderById(db, id);
}

/**
 * Atomically claim all pending reminders whose fire_at has passed. A single
 * UPDATE…RETURNING in SQLite is atomic, so two concurrent workers can never
 * both claim the same row. Returns the claimed rows (now status='fired').
 *
 * NOTE: claimed → fired happens in this one statement. Push delivery is
 * best-effort after that; banner polling is the reliable delivery channel.
 */
export function claimDueReminders(db: DB, nowIso: string): ReminderRow[] {
  return db
    .update(schema.reminders)
    .set({
      status: 'fired',
      firedAt: NOW_SQL as unknown as string,
      updatedAt: NOW_SQL as unknown as string,
    })
    .where(
      and(
        eq(schema.reminders.status, 'pending'),
        dsql`${schema.reminders.fireAt} <= ${nowIso}`,
      ),
    )
    .returning()
    .all();
}

/** Resolve the user IDs that should be notified for a reminder. */
export function targetUserIdsForReminder(
  db: DB,
  row: Pick<ReminderRow, 'scope' | 'ownerUserId'>,
): string[] {
  if (row.scope === 'user') {
    return row.ownerUserId ? [row.ownerUserId] : [];
  }
  const rows = db.select({ id: schema.users.id }).from(schema.users).all();
  return rows.map((r) => r.id);
}
