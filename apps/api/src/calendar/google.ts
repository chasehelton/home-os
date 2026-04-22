// Small, fetch-based Google Calendar client. We deliberately avoid the
// `googleapis` SDK to keep the ARM64 image slim and to keep network I/O
// trivially mockable in tests.

export class GoogleApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

/** Thrown when `refresh_token` is rejected (revoked / expired / wrong client). */
export class InvalidGrantError extends Error {
  constructor(public readonly body: unknown) {
    super('invalid_grant');
    this.name = 'InvalidGrantError';
  }
}

/** 412 Precondition Failed — the local etag didn't match the server's. */
export class EtagMismatchError extends Error {
  constructor(public readonly body: unknown) {
    super('etag_mismatch');
    this.name = 'EtagMismatchError';
  }
}

/** 410 Gone — resource already deleted on Google's side (treat as success on delete). */
export class GoneError extends Error {
  constructor(public readonly body: unknown) {
    super('gone');
    this.name = 'GoneError';
  }
}

/** 403 insufficient permission — the granted scope can't write. Non-retryable. */
export class InsufficientScopeError extends Error {
  constructor(public readonly body: unknown) {
    super('insufficient_scope');
    this.name = 'InsufficientScopeError';
  }
}

export interface AccessTokenResult {
  accessToken: string;
  expiresInS: number;
  scope?: string;
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

/**
 * Exchange a refresh token for a fresh access token. Access tokens are never
 * persisted; callers hold them only for the duration of a sync cycle.
 */
export async function refreshAccessToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<AccessTokenResult> {
  const f = params.fetchImpl ?? fetch;
  const res = await f('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      refresh_token: params.refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (body && body.error === 'invalid_grant') {
      throw new InvalidGrantError(body);
    }
    throw new GoogleApiError('token refresh failed', res.status, body);
  }
  const token = body as unknown as GoogleTokenResponse;
  return {
    accessToken: token.access_token,
    expiresInS: token.expires_in,
    scope: token.scope,
  };
}

export interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  description?: string;
  timeZone?: string;
  colorId?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  primary?: boolean;
  selected?: boolean;
  accessRole?: string;
  deleted?: boolean;
}

export async function listCalendarList(params: {
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleCalendarListEntry[]> {
  const f = params.fetchImpl ?? fetch;
  const out: GoogleCalendarListEntry[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');
    url.searchParams.set('maxResults', '250');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await f(url.toString(), {
      headers: { authorization: `Bearer ${params.accessToken}` },
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new GoogleApiError('calendarList.list failed', res.status, body);
    }
    const items = Array.isArray(body.items) ? (body.items as GoogleCalendarListEntry[]) : [];
    out.push(...items);
    pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : undefined;
  } while (pageToken);
  return out;
}

export interface GoogleEventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface GoogleEvent {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  recurringEventId?: string;
  originalStartTime?: GoogleEventDateTime;
  updated?: string;
  extendedProperties?: {
    private?: Record<string, string>;
    shared?: Record<string, string>;
  };
}

export interface EventsListResult {
  items: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface EventsListParams {
  accessToken: string;
  calendarId: string;
  syncToken?: string;
  pageToken?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Fetch one page of events. Caller handles pagination + syncToken persistence.
 * Always passes `singleEvents=true` so recurring series expand into instances
 * (Phase 5 is a read-only mirror; storing RRULE is deferred).
 *
 * NB: per Google, `timeMin`/`timeMax`/`q` cannot be combined with `syncToken`.
 * We do an unbounded initial full sync and window only at query time.
 */
export async function listEventsPage(params: EventsListParams): Promise<EventsListResult> {
  const f = params.fetchImpl ?? fetch;
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.calendarId)}/events`,
  );
  url.searchParams.set('maxResults', '250');
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('showDeleted', 'true');
  if (params.syncToken) {
    url.searchParams.set('syncToken', params.syncToken);
  } else {
    url.searchParams.set('orderBy', 'startTime');
  }
  if (params.pageToken) url.searchParams.set('pageToken', params.pageToken);

  const res = await f(url.toString(), {
    headers: { authorization: `Bearer ${params.accessToken}` },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new GoogleApiError('events.list failed', res.status, body);
  }
  return {
    items: Array.isArray(body.items) ? (body.items as GoogleEvent[]) : [],
    nextPageToken: typeof body.nextPageToken === 'string' ? body.nextPageToken : undefined,
    nextSyncToken: typeof body.nextSyncToken === 'string' ? body.nextSyncToken : undefined,
  };
}

// ---------------------------------------------------------------------------
// Phase 7 — WRITE client. We intentionally expose only the narrow shape we
// need (non-recurring events on the user's primary calendar). The body we
// send matches Google's wire format; the server replies with the full event
// (including etag), which we return so callers can persist it.
// ---------------------------------------------------------------------------

export interface EventWriteBody {
  summary?: string | null;
  description?: string | null;
  location?: string | null;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  status?: 'confirmed' | 'tentative';
  extendedProperties?: {
    private?: Record<string, string>;
    shared?: Record<string, string>;
  };
}

async function classifyAndThrow(res: Response, op: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 412) throw new EtagMismatchError(body);
  if (res.status === 410) throw new GoneError(body);
  if (res.status === 403) {
    const errs = extractGoogleErrors(body);
    if (errs.some((e) => e === 'insufficientPermissions' || e === 'forbidden')) {
      throw new InsufficientScopeError(body);
    }
  }
  throw new GoogleApiError(`${op} failed`, res.status, body);
}

function extractGoogleErrors(body: Record<string, unknown>): string[] {
  const err = body?.error as { errors?: Array<{ reason?: string }> } | undefined;
  return (err?.errors ?? []).map((e) => e?.reason ?? '').filter(Boolean);
}

export interface InsertEventParams {
  accessToken: string;
  calendarId: string;
  body: EventWriteBody;
  fetchImpl?: typeof fetch;
}

/**
 * Insert a new event. Callers should include an `extendedProperties.private`
 * mutation id so retries after a lost response can be reconciled on the
 * next read sync (Google preserves extendedProperties and echoes them back).
 */
export async function insertEvent(params: InsertEventParams): Promise<GoogleEvent> {
  const f = params.fetchImpl ?? fetch;
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.calendarId)}/events`,
  );
  const res = await f(url.toString(), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${params.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(params.body),
  });
  if (!res.ok) return classifyAndThrow(res, 'events.insert');
  return (await res.json()) as GoogleEvent;
}

export interface PatchEventParams {
  accessToken: string;
  calendarId: string;
  eventId: string;
  etag?: string | null;
  body: EventWriteBody;
  fetchImpl?: typeof fetch;
}

export async function patchEvent(params: PatchEventParams): Promise<GoogleEvent> {
  const f = params.fetchImpl ?? fetch;
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.calendarId)}/events/${encodeURIComponent(params.eventId)}`,
  );
  const headers: Record<string, string> = {
    authorization: `Bearer ${params.accessToken}`,
    'content-type': 'application/json',
  };
  if (params.etag) headers['if-match'] = params.etag;
  const res = await f(url.toString(), {
    method: 'PATCH',
    headers,
    body: JSON.stringify(params.body),
  });
  if (!res.ok) return classifyAndThrow(res, 'events.patch');
  return (await res.json()) as GoogleEvent;
}

export interface DeleteEventParams {
  accessToken: string;
  calendarId: string;
  eventId: string;
  etag?: string | null;
  fetchImpl?: typeof fetch;
}

export async function deleteEvent(params: DeleteEventParams): Promise<void> {
  const f = params.fetchImpl ?? fetch;
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.calendarId)}/events/${encodeURIComponent(params.eventId)}`,
  );
  const headers: Record<string, string> = {
    authorization: `Bearer ${params.accessToken}`,
  };
  if (params.etag) headers['if-match'] = params.etag;
  const res = await f(url.toString(), { method: 'DELETE', headers });
  if (res.status === 204 || res.status === 200) return;
  if (res.status === 410) return; // Already gone — idempotent success.
  await classifyAndThrow(res, 'events.delete');
}

/**
 * List events by a private extendedProperty. Used by the retry engine to
 * discover whether a `POST` we previously tried already succeeded on Google's
 * side (after a crash / timeout / dropped response) — avoids duplicates.
 *
 * Returns the first matching event, or null.
 */
export async function findByMutationId(params: {
  accessToken: string;
  calendarId: string;
  mutationId: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleEvent | null> {
  const f = params.fetchImpl ?? fetch;
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.calendarId)}/events`,
  );
  url.searchParams.set('maxResults', '2');
  url.searchParams.set('showDeleted', 'true');
  url.searchParams.set('privateExtendedProperty', `homeOsMutationId=${params.mutationId}`);
  const res = await f(url.toString(), {
    headers: { authorization: `Bearer ${params.accessToken}` },
  });
  if (!res.ok) return classifyAndThrow(res, 'events.list(byMutation)');
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const items = Array.isArray(body.items) ? (body.items as GoogleEvent[]) : [];
  return items[0] ?? null;
}
