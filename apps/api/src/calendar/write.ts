// Phase 7 — local-first WRITE engine for Google Calendar.
//
// Flow:
//   1. API handler validates input, writes a local row with local_dirty=1 and
//      a `pending_op` describing the intended mutation. The row is returned
//      to the caller immediately (local-first UX).
//   2. An attempt to push to Google is made inline under the per-account
//      lock. On any transient failure the row stays dirty and the periodic
//      worker retries on its next tick.
//   3. On 412 (etag mismatch) the server-side value wins: we overwrite the
//      local row with Google's current state and park the user's attempted
//      payload in `conflict_payload` so the UI can surface it.
//   4. CREATEs carry a stable `mutation_id` stored in the Google event's
//      extendedProperties.private — so retries after a lost response can
//      be reconciled on the next read sync (see sync.ts::applyEventRow).

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DB } from '@home-os/db';
import { schema } from '@home-os/db';
import { logAudit } from '../auth/audit.js';
import {
  EtagMismatchError,
  GoneError,
  InsufficientScopeError,
  InvalidGrantError,
  deleteEvent,
  findByMutationId,
  insertEvent,
  patchEvent,
  refreshAccessToken,
  type EventWriteBody,
  type GoogleEvent,
} from './google.js';
import type { AccountRow, CalendarListRow, SyncConfig } from './sync.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EventCreateInput {
  calendarListId: string;
  title: string | null;
  description?: string | null;
  location?: string | null;
  status?: 'confirmed' | 'tentative';
  allDay: boolean;
  startAt?: string | null;
  endAt?: string | null;
  startDate?: string | null;
  endDateExclusive?: string | null;
  startTz?: string | null;
  endTz?: string | null;
}

export interface EventUpdateInput {
  title?: string | null;
  description?: string | null;
  location?: string | null;
  status?: 'confirmed' | 'tentative';
  allDay?: boolean;
  startAt?: string | null;
  endAt?: string | null;
  startDate?: string | null;
  endDateExclusive?: string | null;
  startTz?: string | null;
  endTz?: string | null;
}

export type EventRowFull = typeof schema.calendarEvents.$inferSelect;

export class WriteError extends Error {
  constructor(
    public readonly code:
      | 'not_found'
      | 'recurring_edit_unsupported'
      | 'not_primary_calendar'
      | 'invalid_times'
      | 'write_scope_missing'
      | 'conflict',
    message?: string
  ) {
    super(message ?? code);
    this.name = 'WriteError';
  }
}

// ---------------------------------------------------------------------------
// Local mutations
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function validateTimes(i: {
  allDay: boolean;
  startAt?: string | null;
  endAt?: string | null;
  startDate?: string | null;
  endDateExclusive?: string | null;
}): void {
  if (i.allDay) {
    if (!i.startDate || !i.endDateExclusive) {
      throw new WriteError('invalid_times', 'all_day requires startDate+endDateExclusive');
    }
    if (i.endDateExclusive <= i.startDate) {
      throw new WriteError('invalid_times', 'endDateExclusive must be > startDate');
    }
  } else {
    if (!i.startAt || !i.endAt) {
      throw new WriteError('invalid_times', 'timed event requires startAt+endAt');
    }
    if (new Date(i.endAt).valueOf() <= new Date(i.startAt).valueOf()) {
      throw new WriteError('invalid_times', 'endAt must be > startAt');
    }
  }
}

export interface WriteContext {
  db: DB;
  calendarList: CalendarListRow;
  account: AccountRow;
  cfg: SyncConfig;
}

export function resolveWriteContext(
  db: DB,
  userId: string,
  calendarListId: string
): { list: CalendarListRow; account: AccountRow } {
  const list = db
    .select()
    .from(schema.calendarLists)
    .where(eq(schema.calendarLists.id, calendarListId))
    .get() as CalendarListRow | undefined;
  if (!list) throw new WriteError('not_found');
  const account = db
    .select()
    .from(schema.calendarAccounts)
    .where(eq(schema.calendarAccounts.id, list.accountId))
    .get() as AccountRow | undefined;
  if (!account || account.userId !== userId) throw new WriteError('not_found');
  if (!list.primary) throw new WriteError('not_primary_calendar');
  return { list, account };
}

export function createLocalEvent(
  db: DB,
  userId: string,
  input: EventCreateInput
): EventRowFull {
  validateTimes(input);
  const { list, account } = resolveWriteContext(db, userId, input.calendarListId);
  if (account.status !== 'active') throw new WriteError('not_found');

  const id = nanoid(21);
  const mutationId = nanoid(21);
  const provisionalGoogleId = `local:${mutationId}`;
  db.insert(schema.calendarEvents)
    .values({
      id,
      calendarListId: list.id,
      googleEventId: provisionalGoogleId,
      etag: null,
      status: input.status ?? 'confirmed',
      allDay: input.allDay,
      startAt: input.startAt ?? null,
      endAt: input.endAt ?? null,
      startDate: input.startDate ?? null,
      endDateExclusive: input.endDateExclusive ?? null,
      startTz: input.startTz ?? null,
      endTz: input.endTz ?? null,
      title: input.title ?? null,
      description: input.description ?? null,
      location: input.location ?? null,
      htmlLink: null,
      recurringEventId: null,
      originalStartTime: null,
      googleUpdatedAt: null,
      localDirty: true,
      pendingOp: 'create',
      mutationId,
    })
    .run();
  logAudit(db, {
    actorUserId: userId,
    action: 'calendar.event.create.local',
    entity: 'calendar_event',
    entityId: id,
    after: { title: input.title, calendarListId: list.id },
  });
  return getEventRow(db, id);
}

export function updateLocalEvent(
  db: DB,
  userId: string,
  id: string,
  input: EventUpdateInput
): EventRowFull {
  const row = getOwnedEvent(db, userId, id);
  if (row.recurringEventId) throw new WriteError('recurring_edit_unsupported');
  if (row.pendingOp === 'delete') throw new WriteError('not_found');

  const merged = {
    title: input.title !== undefined ? input.title : row.title,
    description: input.description !== undefined ? input.description : row.description,
    location: input.location !== undefined ? input.location : row.location,
    status: input.status ?? (row.status === 'cancelled' ? 'confirmed' : row.status),
    allDay: input.allDay !== undefined ? input.allDay : row.allDay,
    startAt: input.startAt !== undefined ? input.startAt : row.startAt,
    endAt: input.endAt !== undefined ? input.endAt : row.endAt,
    startDate: input.startDate !== undefined ? input.startDate : row.startDate,
    endDateExclusive:
      input.endDateExclusive !== undefined ? input.endDateExclusive : row.endDateExclusive,
    startTz: input.startTz !== undefined ? input.startTz : row.startTz,
    endTz: input.endTz !== undefined ? input.endTz : row.endTz,
  };
  validateTimes(merged);

  // State collapse: create → update stays 'create' (still an unpushed new event).
  const nextOp = row.pendingOp === 'create' ? 'create' : 'update';
  db.update(schema.calendarEvents)
    .set({
      ...merged,
      localDirty: true,
      pendingOp: nextOp,
      updatedAt: nowIso(),
    })
    .where(eq(schema.calendarEvents.id, id))
    .run();
  logAudit(db, {
    actorUserId: userId,
    action: 'calendar.event.update.local',
    entity: 'calendar_event',
    entityId: id,
    after: { title: merged.title },
  });
  return getEventRow(db, id);
}

/**
 * Delete a user-owned non-recurring event.
 * - If the event has never been pushed (pending_op='create'), drop the row
 *   entirely — there's nothing to tell Google about.
 * - Otherwise mark as pending delete (tombstone) and let push/worker flush.
 */
export function deleteLocalEvent(db: DB, userId: string, id: string): 'dropped' | 'tombstoned' {
  const row = getOwnedEvent(db, userId, id);
  if (row.recurringEventId) throw new WriteError('recurring_edit_unsupported');

  if (row.pendingOp === 'create') {
    db.delete(schema.calendarEvents).where(eq(schema.calendarEvents.id, id)).run();
    logAudit(db, {
      actorUserId: userId,
      action: 'calendar.event.delete.local.dropped',
      entity: 'calendar_event',
      entityId: id,
    });
    return 'dropped';
  }

  db.update(schema.calendarEvents)
    .set({
      localDirty: true,
      pendingOp: 'delete',
      updatedAt: nowIso(),
    })
    .where(eq(schema.calendarEvents.id, id))
    .run();
  logAudit(db, {
    actorUserId: userId,
    action: 'calendar.event.delete.local',
    entity: 'calendar_event',
    entityId: id,
  });
  return 'tombstoned';
}

export function getOwnedEvent(db: DB, userId: string, id: string): EventRowFull {
  const row = db
    .select({
      row: schema.calendarEvents,
      accountUserId: schema.calendarAccounts.userId,
    })
    .from(schema.calendarEvents)
    .innerJoin(
      schema.calendarLists,
      eq(schema.calendarEvents.calendarListId, schema.calendarLists.id)
    )
    .innerJoin(
      schema.calendarAccounts,
      eq(schema.calendarLists.accountId, schema.calendarAccounts.id)
    )
    .where(eq(schema.calendarEvents.id, id))
    .get();
  if (!row || row.accountUserId !== userId) throw new WriteError('not_found');
  return row.row;
}

function getEventRow(db: DB, id: string): EventRowFull {
  const row = db
    .select()
    .from(schema.calendarEvents)
    .where(eq(schema.calendarEvents.id, id))
    .get();
  if (!row) throw new WriteError('not_found');
  return row as EventRowFull;
}

// ---------------------------------------------------------------------------
// Push engine
// ---------------------------------------------------------------------------

export interface PushResult {
  attempted: number;
  pushed: number;
  conflicts: number;
  errors: number;
}

function toGoogleBody(
  row: EventRowFull,
  mutationId: string | null
): EventWriteBody {
  const body: EventWriteBody = {
    summary: row.title ?? undefined,
    description: row.description ?? undefined,
    location: row.location ?? undefined,
    status: (row.status === 'cancelled' ? 'confirmed' : row.status) as 'confirmed' | 'tentative',
  };
  if (row.allDay) {
    body.start = { date: row.startDate ?? undefined };
    body.end = { date: row.endDateExclusive ?? undefined };
  } else {
    body.start = {
      dateTime: row.startAt ?? undefined,
      timeZone: row.startTz ?? undefined,
    };
    body.end = {
      dateTime: row.endAt ?? undefined,
      timeZone: row.endTz ?? undefined,
    };
  }
  if (mutationId) {
    body.extendedProperties = { private: { homeOsMutationId: mutationId } };
  }
  return body;
}

async function getAccessToken(
  account: AccountRow,
  cfg: SyncConfig
): Promise<string> {
  if (!account.refreshTokenEnc) throw new Error('account_inactive');
  const refreshToken = cfg.crypto.open(account.refreshTokenEnc);
  const { accessToken } = await refreshAccessToken({
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    refreshToken,
    fetchImpl: cfg.fetchImpl,
  });
  return accessToken;
}

/**
 * Push every dirty row belonging to `account`. Caller must hold the
 * per-account lock (see `withAccountLock`).
 */
export async function pushPendingForAccount(
  db: DB,
  account: AccountRow,
  cfg: SyncConfig
): Promise<PushResult> {
  const out: PushResult = { attempted: 0, pushed: 0, conflicts: 0, errors: 0 };
  const dirtyRows = db
    .select({
      event: schema.calendarEvents,
      list: schema.calendarLists,
    })
    .from(schema.calendarEvents)
    .innerJoin(
      schema.calendarLists,
      eq(schema.calendarEvents.calendarListId, schema.calendarLists.id)
    )
    .where(
      and(
        eq(schema.calendarLists.accountId, account.id),
        eq(schema.calendarEvents.localDirty, true)
      )
    )
    .all();
  if (dirtyRows.length === 0) return out;
  if (!account.refreshTokenEnc || account.status !== 'active') return out;

  let accessToken: string;
  try {
    accessToken = await getAccessToken(account, cfg);
  } catch (err) {
    if (err instanceof InvalidGrantError) return out; // sync loop handles disable.
    for (const { event } of dirtyRows) {
      setPushError(db, event.id, (err as Error).message);
    }
    out.errors += dirtyRows.length;
    return out;
  }

  for (const { event, list } of dirtyRows) {
    out.attempted += 1;
    try {
      await pushOne(db, event as EventRowFull, list as CalendarListRow, accessToken, cfg);
      out.pushed += 1;
    } catch (err) {
      if (err instanceof EtagMismatchError) {
        markConflict(db, event as EventRowFull);
        out.conflicts += 1;
      } else if (err instanceof InsufficientScopeError) {
        // Non-retryable — record on the account and stop for this run.
        db.update(schema.calendarAccounts)
          .set({
            lastError: 'write_scope_missing',
            updatedAt: nowIso(),
          })
          .where(eq(schema.calendarAccounts.id, account.id))
          .run();
        setPushError(db, event.id, 'write_scope_missing');
        out.errors += 1;
        break;
      } else {
        setPushError(db, event.id, (err as Error).message);
        out.errors += 1;
      }
    }
  }
  return out;
}

async function pushOne(
  db: DB,
  row: EventRowFull,
  list: CalendarListRow,
  accessToken: string,
  cfg: SyncConfig
): Promise<void> {
  const op = row.pendingOp;
  if (!op) {
    // Row was flipped dirty but lost its op — clear dirty to avoid a loop.
    db.update(schema.calendarEvents)
      .set({ localDirty: false, lastPushError: null, lastPushAttemptAt: nowIso() })
      .where(eq(schema.calendarEvents.id, row.id))
      .run();
    return;
  }

  if (op === 'create') {
    let created: GoogleEvent;
    // Defense against lost-response dup: if this is a retry (we've attempted
    // this row before) AND we have a mutationId, probe Google first to see
    // if a previous POST actually landed; otherwise go straight to insert.
    const isRetry = row.lastPushAttemptAt != null;
    const existingOnGoogle =
      isRetry && row.mutationId
        ? await findByMutationId({
            accessToken,
            calendarId: list.googleCalendarId,
            mutationId: row.mutationId,
            fetchImpl: cfg.fetchImpl,
          })
        : null;
    if (existingOnGoogle && existingOnGoogle.id) {
      created = existingOnGoogle;
    } else {
      created = await insertEvent({
        accessToken,
        calendarId: list.googleCalendarId,
        body: toGoogleBody(row, row.mutationId),
        fetchImpl: cfg.fetchImpl,
      });
    }
    db.update(schema.calendarEvents)
      .set({
        googleEventId: created.id,
        etag: created.etag ?? null,
        htmlLink: created.htmlLink ?? null,
        googleUpdatedAt: created.updated ?? null,
        localDirty: false,
        pendingOp: null,
        lastPushError: null,
        lastPushAttemptAt: nowIso(),
        updatedAt: nowIso(),
      })
      .where(eq(schema.calendarEvents.id, row.id))
      .run();
    return;
  }

  if (op === 'update') {
    const updated = await patchEvent({
      accessToken,
      calendarId: list.googleCalendarId,
      eventId: row.googleEventId,
      etag: row.etag,
      body: toGoogleBody(row, null),
      fetchImpl: cfg.fetchImpl,
    });
    db.update(schema.calendarEvents)
      .set({
        etag: updated.etag ?? null,
        htmlLink: updated.htmlLink ?? row.htmlLink,
        googleUpdatedAt: updated.updated ?? null,
        localDirty: false,
        pendingOp: null,
        lastPushError: null,
        lastPushAttemptAt: nowIso(),
        updatedAt: nowIso(),
      })
      .where(eq(schema.calendarEvents.id, row.id))
      .run();
    return;
  }

  // op === 'delete'
  try {
    await deleteEvent({
      accessToken,
      calendarId: list.googleCalendarId,
      eventId: row.googleEventId,
      etag: row.etag,
      fetchImpl: cfg.fetchImpl,
    });
  } catch (err) {
    if (!(err instanceof GoneError)) throw err;
  }
  db.delete(schema.calendarEvents).where(eq(schema.calendarEvents.id, row.id)).run();
}

function setPushError(db: DB, id: string, message: string): void {
  db.update(schema.calendarEvents)
    .set({
      lastPushError: message.slice(0, 500),
      lastPushAttemptAt: nowIso(),
    })
    .where(eq(schema.calendarEvents.id, id))
    .run();
}

function markConflict(db: DB, row: EventRowFull): void {
  const payload = JSON.stringify({
    title: row.title,
    description: row.description,
    location: row.location,
    status: row.status,
    allDay: row.allDay,
    startAt: row.startAt,
    endAt: row.endAt,
    startDate: row.startDate,
    endDateExclusive: row.endDateExclusive,
    startTz: row.startTz,
    endTz: row.endTz,
    pendingOp: row.pendingOp,
  });
  // Clear dirty so the next sync will refresh the local row with server truth.
  // User resolves via UI (discard or re-apply with new base etag).
  db.update(schema.calendarEvents)
    .set({
      localDirty: false,
      pendingOp: null,
      etag: null, // force fresh read next sync
      conflictPayload: payload,
      lastPushError: 'etag_mismatch',
      lastPushAttemptAt: nowIso(),
    })
    .where(eq(schema.calendarEvents.id, row.id))
    .run();
}
