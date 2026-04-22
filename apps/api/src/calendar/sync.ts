import { and, eq, gte, lte, or, sql as dsql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DB } from '@home-os/db';
import { schema } from '@home-os/db';
import { logAudit } from '../auth/audit.js';
import type { TokenCrypto } from '../auth/crypto.js';
import {
  GoogleApiError,
  InvalidGrantError,
  listCalendarList,
  listEventsPage,
  refreshAccessToken,
  type GoogleCalendarListEntry,
  type GoogleEvent,
} from './google.js';

const NOW_SQL = dsql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export interface SyncConfig {
  clientId: string;
  clientSecret: string;
  crypto: TokenCrypto;
  fetchImpl?: typeof fetch;
}

export interface AccountRow {
  id: string;
  userId: string;
  googleSub: string;
  email: string;
  refreshTokenEnc: string | null;
  scopes: string;
  status: 'active' | 'disabled';
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarListRow {
  id: string;
  accountId: string;
  googleCalendarId: string;
  summary: string;
  description: string | null;
  colorId: string | null;
  backgroundColor: string | null;
  foregroundColor: string | null;
  timeZone: string | null;
  primary: boolean;
  selected: boolean;
  syncToken: string | null;
  lastFullSyncAt: string | null;
  lastIncrementalSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Per-account async mutex to prevent overlapping sync cycles for the same
// account (race: ongoing background run + user-triggered "Sync now").
const accountLocks = new Map<string, Promise<void>>();

export async function withAccountLock<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
  const prev = accountLocks.get(accountId) ?? Promise.resolve();
  let resolve!: () => void;
  const next = new Promise<void>((r) => {
    resolve = r;
  });
  accountLocks.set(accountId, prev.then(() => next));
  try {
    await prev;
    return await fn();
  } finally {
    resolve();
    if (accountLocks.get(accountId) === prev.then(() => next)) {
      accountLocks.delete(accountId);
    }
  }
}

export interface SyncAccountResult {
  accountId: string;
  upserted: number;
  deleted: number;
  cancelledKept: number;
  calendarsChecked: number;
  error?: string;
  disabled?: boolean;
}

/**
 * Top-level: refresh an access token, sync the user's calendarList, then
 * sync events for every row still present. Caller provides a lock if needed.
 */
export async function syncAccount(
  db: DB,
  account: AccountRow,
  cfg: SyncConfig
): Promise<SyncAccountResult> {
  const result: SyncAccountResult = {
    accountId: account.id,
    upserted: 0,
    deleted: 0,
    cancelledKept: 0,
    calendarsChecked: 0,
  };
  if (!account.refreshTokenEnc || account.status === 'disabled') {
    return { ...result, error: 'account_inactive' };
  }

  let accessToken: string;
  try {
    const refreshToken = cfg.crypto.open(account.refreshTokenEnc);
    const { accessToken: at } = await refreshAccessToken({
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      refreshToken,
      fetchImpl: cfg.fetchImpl,
    });
    accessToken = at;
  } catch (err) {
    if (err instanceof InvalidGrantError) {
      disableAccount(db, account.id, 'invalid_grant');
      return { ...result, error: 'invalid_grant', disabled: true };
    }
    const msg = err instanceof Error ? err.message : 'refresh_failed';
    setLastError(db, account.id, msg);
    return { ...result, error: msg };
  }

  let remoteCalendars: GoogleCalendarListEntry[];
  try {
    remoteCalendars = await listCalendarList({ accessToken, fetchImpl: cfg.fetchImpl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'calendar_list_failed';
    setLastError(db, account.id, msg);
    return { ...result, error: msg };
  }

  upsertCalendarLists(db, account.id, remoteCalendars);

  const lists = db
    .select()
    .from(schema.calendarLists)
    .where(eq(schema.calendarLists.accountId, account.id))
    .all() as CalendarListRow[];

  for (const list of lists) {
    if (!list.selected) continue;
    result.calendarsChecked += 1;
    try {
      const pageResult = await syncEventsForCalendar(db, list, accessToken, cfg);
      result.upserted += pageResult.upserted;
      result.deleted += pageResult.deleted;
      result.cancelledKept += pageResult.cancelledKept;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'events_sync_failed';
      setLastError(db, account.id, msg);
      result.error = msg;
    }
  }

  if (!result.error) clearLastError(db, account.id);
  return result;
}

interface EventSyncResult {
  upserted: number;
  deleted: number;
  cancelledKept: number;
}

async function syncEventsForCalendar(
  db: DB,
  list: CalendarListRow,
  accessToken: string,
  cfg: SyncConfig
): Promise<EventSyncResult> {
  const full = !list.syncToken;
  let pageToken: string | undefined;
  let newSyncToken: string | undefined;
  const out: EventSyncResult = { upserted: 0, deleted: 0, cancelledKept: 0 };
  // Collect pages first; persist the new sync_token only after the last
  // page succeeds (so a mid-pagination failure doesn't lose changes).
  const collected: GoogleEvent[] = [];
  try {
    do {
      const page = await listEventsPage({
        accessToken,
        calendarId: list.googleCalendarId,
        syncToken: list.syncToken ?? undefined,
        pageToken,
        fetchImpl: cfg.fetchImpl,
      });
      collected.push(...page.items);
      pageToken = page.nextPageToken;
      if (!pageToken && page.nextSyncToken) newSyncToken = page.nextSyncToken;
    } while (pageToken);
  } catch (err) {
    if (err instanceof GoogleApiError && err.status === 410) {
      // syncToken expired — clear it and let the next run do a full resync.
      db.update(schema.calendarLists)
        .set({ syncToken: null, updatedAt: NOW_SQL as unknown as string })
        .where(eq(schema.calendarLists.id, list.id))
        .run();
      return out;
    }
    throw err;
  }

  for (const ev of collected) {
    const res = applyEventRow(db, list.id, ev, full);
    out.upserted += res.upserted;
    out.deleted += res.deleted;
    out.cancelledKept += res.cancelledKept;
  }

  const nowIso = new Date().toISOString();
  db.update(schema.calendarLists)
    .set({
      syncToken: newSyncToken ?? list.syncToken,
      lastFullSyncAt: full ? nowIso : list.lastFullSyncAt,
      lastIncrementalSyncAt: full ? list.lastIncrementalSyncAt : nowIso,
      updatedAt: NOW_SQL as unknown as string,
    })
    .where(eq(schema.calendarLists.id, list.id))
    .run();
  return out;
}

interface ApplyResult {
  upserted: number;
  deleted: number;
  cancelledKept: number;
}

function applyEventRow(
  db: DB,
  calendarListId: string,
  ev: GoogleEvent,
  isFullSync: boolean
): ApplyResult {
  const out: ApplyResult = { upserted: 0, deleted: 0, cancelledKept: 0 };
  if (!ev.id) return out;
  const existing = db
    .select()
    .from(schema.calendarEvents)
    .where(
      and(
        eq(schema.calendarEvents.calendarListId, calendarListId),
        eq(schema.calendarEvents.googleEventId, ev.id)
      )
    )
    .get();

  // Cancellation: during incremental sync, Google sends a stub with
  // status='cancelled' (and often only id/status). On a full sync, cancelled
  // events are typically pruned from the result; when we do see one, drop it.
  if (ev.status === 'cancelled') {
    if (existing) {
      if (isFullSync) {
        db.delete(schema.calendarEvents)
          .where(eq(schema.calendarEvents.id, existing.id))
          .run();
        out.deleted += 1;
      } else {
        // Incremental cancellation: remove the row — it no longer exists on
        // the remote side (read-only mirror).
        db.delete(schema.calendarEvents)
          .where(eq(schema.calendarEvents.id, existing.id))
          .run();
        out.deleted += 1;
      }
    } else {
      out.cancelledKept += 1;
    }
    return out;
  }

  const start = normalizeEventTime(ev.start);
  const end = normalizeEventTime(ev.end);
  const allDay = !!start.date;

  const values = {
    calendarListId,
    googleEventId: ev.id,
    etag: ev.etag ?? null,
    status: (ev.status === 'tentative' ? 'tentative' : 'confirmed') as 'confirmed' | 'tentative',
    allDay,
    startAt: start.dateTime ?? null,
    endAt: end.dateTime ?? null,
    startDate: start.date ?? null,
    endDateExclusive: end.date ?? null,
    startTz: start.timeZone ?? null,
    endTz: end.timeZone ?? null,
    title: ev.summary ?? null,
    description: ev.description ?? null,
    location: ev.location ?? null,
    htmlLink: ev.htmlLink ?? null,
    recurringEventId: ev.recurringEventId ?? null,
    originalStartTime:
      ev.originalStartTime?.dateTime ?? ev.originalStartTime?.date ?? null,
    googleUpdatedAt: ev.updated ?? null,
    updatedAt: NOW_SQL as unknown as string,
  };

  if (existing) {
    db.update(schema.calendarEvents)
      .set(values)
      .where(eq(schema.calendarEvents.id, existing.id))
      .run();
  } else {
    db.insert(schema.calendarEvents)
      .values({ id: nanoid(21), ...values })
      .run();
  }
  out.upserted += 1;
  return out;
}

function normalizeEventTime(t: GoogleEvent['start']): {
  dateTime?: string;
  date?: string;
  timeZone?: string;
} {
  if (!t) return {};
  if (t.dateTime) {
    // Normalize to a proper ISO string with offset; Google's dateTime is
    // already offset-formatted but we pass through New Date to fail fast on
    // malformed input.
    const parsed = new Date(t.dateTime);
    const iso = Number.isNaN(parsed.valueOf()) ? t.dateTime : parsed.toISOString();
    return { dateTime: iso, timeZone: t.timeZone };
  }
  if (t.date) return { date: t.date, timeZone: t.timeZone };
  return {};
}

function upsertCalendarLists(
  db: DB,
  accountId: string,
  remote: GoogleCalendarListEntry[]
): void {
  const existing = db
    .select()
    .from(schema.calendarLists)
    .where(eq(schema.calendarLists.accountId, accountId))
    .all();
  const byId = new Map(existing.map((r) => [r.googleCalendarId, r]));

  for (const r of remote) {
    if (r.deleted) {
      const e = byId.get(r.id);
      if (e) {
        db.delete(schema.calendarLists)
          .where(eq(schema.calendarLists.id, e.id))
          .run();
      }
      continue;
    }
    const e = byId.get(r.id);
    if (e) {
      db.update(schema.calendarLists)
        .set({
          summary: r.summary,
          description: r.description ?? null,
          colorId: r.colorId ?? null,
          backgroundColor: r.backgroundColor ?? null,
          foregroundColor: r.foregroundColor ?? null,
          timeZone: r.timeZone ?? null,
          primary: r.primary === true,
          // Respect user's local "selected" choice if we've ever stored one;
          // fall back to remote's selected / primary for brand-new rows (handled
          // below in the insert branch).
          updatedAt: NOW_SQL as unknown as string,
        })
        .where(eq(schema.calendarLists.id, e.id))
        .run();
    } else {
      db.insert(schema.calendarLists)
        .values({
          id: nanoid(21),
          accountId,
          googleCalendarId: r.id,
          summary: r.summary,
          description: r.description ?? null,
          colorId: r.colorId ?? null,
          backgroundColor: r.backgroundColor ?? null,
          foregroundColor: r.foregroundColor ?? null,
          timeZone: r.timeZone ?? null,
          primary: r.primary === true,
          selected: r.primary === true || r.selected === true,
        })
        .run();
    }
  }
}

function disableAccount(db: DB, id: string, reason: string): void {
  db.update(schema.calendarAccounts)
    .set({
      status: 'disabled',
      lastError: reason,
      refreshTokenEnc: null,
      updatedAt: NOW_SQL as unknown as string,
    })
    .where(eq(schema.calendarAccounts.id, id))
    .run();
  logAudit(db, {
    actorUserId: null,
    action: 'calendar.account.disabled',
    entity: 'calendar_account',
    entityId: id,
    after: { reason },
  });
}

function setLastError(db: DB, id: string, reason: string): void {
  db.update(schema.calendarAccounts)
    .set({
      lastError: reason,
      updatedAt: NOW_SQL as unknown as string,
    })
    .where(eq(schema.calendarAccounts.id, id))
    .run();
}

function clearLastError(db: DB, id: string): void {
  db.update(schema.calendarAccounts)
    .set({
      lastError: null,
      updatedAt: NOW_SQL as unknown as string,
    })
    .where(eq(schema.calendarAccounts.id, id))
    .run();
}

// ---- Reads -----------------------------------------------------------------

export interface EventRow {
  id: string;
  calendarListId: string;
  googleEventId: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  allDay: boolean;
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  endDateExclusive: string | null;
  startTz: string | null;
  endTz: string | null;
  title: string | null;
  description: string | null;
  location: string | null;
  htmlLink: string | null;
  recurringEventId: string | null;
  originalStartTime: string | null;
}

export function listEventsForUserBetween(
  db: DB,
  userId: string,
  from: string,
  to: string
): EventRow[] {
  // Window includes events whose (start, end) overlap the [from, to] date range.
  // For all-day events compare on start_date; for timed events compare on start_at.
  const fromIso = `${from}T00:00:00.000Z`;
  // 'to' is inclusive; include the full day by bumping to the next morning UTC.
  const toNextIso = `${to}T23:59:59.999Z`;

  return db
    .select({
      id: schema.calendarEvents.id,
      calendarListId: schema.calendarEvents.calendarListId,
      googleEventId: schema.calendarEvents.googleEventId,
      status: schema.calendarEvents.status,
      allDay: schema.calendarEvents.allDay,
      startAt: schema.calendarEvents.startAt,
      endAt: schema.calendarEvents.endAt,
      startDate: schema.calendarEvents.startDate,
      endDateExclusive: schema.calendarEvents.endDateExclusive,
      startTz: schema.calendarEvents.startTz,
      endTz: schema.calendarEvents.endTz,
      title: schema.calendarEvents.title,
      description: schema.calendarEvents.description,
      location: schema.calendarEvents.location,
      htmlLink: schema.calendarEvents.htmlLink,
      recurringEventId: schema.calendarEvents.recurringEventId,
      originalStartTime: schema.calendarEvents.originalStartTime,
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
    .where(
      and(
        eq(schema.calendarAccounts.userId, userId),
        eq(schema.calendarLists.selected, true),
        or(
          and(
            eq(schema.calendarEvents.allDay, true),
            // all-day: start_date in window
            gte(schema.calendarEvents.startDate, from),
            lte(schema.calendarEvents.startDate, to)
          ),
          and(
            eq(schema.calendarEvents.allDay, false),
            gte(schema.calendarEvents.startAt, fromIso),
            lte(schema.calendarEvents.startAt, toNextIso)
          )
        )
      )
    )
    .orderBy(schema.calendarEvents.startDate, schema.calendarEvents.startAt)
    .all() as EventRow[];
}

export function listAccountsForUser(
  db: DB,
  userId: string
): Array<AccountRow & { calendars: CalendarListRow[] }> {
  const accounts = db
    .select()
    .from(schema.calendarAccounts)
    .where(eq(schema.calendarAccounts.userId, userId))
    .all() as AccountRow[];
  return accounts.map((a) => ({
    ...a,
    calendars: db
      .select()
      .from(schema.calendarLists)
      .where(eq(schema.calendarLists.accountId, a.id))
      .all() as CalendarListRow[],
  }));
}
