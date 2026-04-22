import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ---------------------------------------------------------------------------
// Phase 0 / 1 tables. Additional tables (recipes, meal plans, calendar, etc.)
// are added in their respective phases per plan.md.
// ---------------------------------------------------------------------------

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  googleSub: text('google_sub').unique(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  displayName: text('display_name').notNull(),
  pictureUrl: text('picture_url'),
  color: text('color'),
  pinHash: text('pin_hash'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

export const todos = sqliteTable('todos', {
  id: text('id').primaryKey(),
  scope: text('scope', { enum: ['household', 'user'] }).notNull(),
  ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  notes: text('notes'),
  dueAt: text('due_at'),
  completedAt: text('completed_at'),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

export const auditLog = sqliteTable('audit_log', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  beforeJson: text('before_json'),
  afterJson: text('after_json'),
  at: text('at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

export const recipes = sqliteTable('recipes', {
  id: text('id').primaryKey(),
  sourceUrl: text('source_url'),
  title: text('title').notNull(),
  description: text('description'),
  author: text('author'),
  siteName: text('site_name'),
  domain: text('domain'),
  imagePath: text('image_path'),
  imageSourceUrl: text('image_source_url'),
  importStatus: text('import_status', {
    enum: ['imported', 'partial', 'manual'],
  }).notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

// Phase 4 — Meal planning. One row per planned meal. Multiple entries per
// (date, slot) are allowed (e.g. several snacks in a day). recipeId is a
// soft reference: if the underlying recipe is deleted the entry is preserved
// with just its stored title for historical context.
export const mealPlanEntries = sqliteTable(
  'meal_plan_entries',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    slot: text('slot', { enum: ['breakfast', 'lunch', 'dinner', 'snack'] }).notNull(),
    recipeId: text('recipe_id').references(() => recipes.id, { onDelete: 'set null' }),
    title: text('title'),
    notes: text('notes'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (t) => ({
    dateSlotIdx: index('meal_plan_entries_date_slot_idx').on(t.date, t.slot),
  })
);

// ---------------------------------------------------------------------------
// Phase 5 — Calendar READ sync (Google).
//
// Each user connects their own Google account; tokens are encrypted at rest
// with the AES-GCM key configured via HOME_OS_TOKEN_KEY. Only the refresh
// token is persisted — access tokens are fetched on demand per sync cycle.
// Events are a read-only mirror: we ask Google to expand recurring series
// into individual instances (singleEvents=true), and store `recurring_event_id`
// + `original_start_time` for display grouping.
// ---------------------------------------------------------------------------

export const calendarAccounts = sqliteTable(
  'calendar_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    googleSub: text('google_sub').notNull(),
    email: text('email').notNull(),
    refreshTokenEnc: text('refresh_token_enc'),
    scopes: text('scopes').notNull(),
    status: text('status', { enum: ['active', 'disabled'] }).notNull().default('active'),
    lastError: text('last_error'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (t) => ({
    bySub: uniqueIndex('calendar_accounts_google_sub_idx').on(t.googleSub),
    byUserStatus: index('calendar_accounts_user_status_idx').on(t.userId, t.status),
  })
);

export const calendarLists = sqliteTable(
  'calendar_lists',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => calendarAccounts.id, { onDelete: 'cascade' }),
    googleCalendarId: text('google_calendar_id').notNull(),
    summary: text('summary').notNull(),
    description: text('description'),
    colorId: text('color_id'),
    backgroundColor: text('background_color'),
    foregroundColor: text('foreground_color'),
    timeZone: text('time_zone'),
    primary: integer('primary', { mode: 'boolean' }).notNull().default(false),
    selected: integer('selected', { mode: 'boolean' }).notNull().default(true),
    syncToken: text('sync_token'),
    lastFullSyncAt: text('last_full_sync_at'),
    lastIncrementalSyncAt: text('last_incremental_sync_at'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (t) => ({
    byAccountCal: uniqueIndex('calendar_lists_account_google_idx').on(
      t.accountId,
      t.googleCalendarId
    ),
    byAccount: index('calendar_lists_account_idx').on(t.accountId),
  })
);

// Store both "timed" (start_at / end_at, UTC ISO) and "all-day" (start_date /
// end_date_exclusive, YYYY-MM-DD) shapes. Renderers decide which to use based
// on `all_day`. This preserves the original Google shape and avoids DST bugs.
export const calendarEvents = sqliteTable(
  'calendar_events',
  {
    id: text('id').primaryKey(),
    calendarListId: text('calendar_list_id')
      .notNull()
      .references(() => calendarLists.id, { onDelete: 'cascade' }),
    googleEventId: text('google_event_id').notNull(),
    etag: text('etag'),
    status: text('status', { enum: ['confirmed', 'tentative', 'cancelled'] }).notNull(),
    allDay: integer('all_day', { mode: 'boolean' }).notNull().default(false),
    startAt: text('start_at'),
    endAt: text('end_at'),
    startDate: text('start_date'),
    endDateExclusive: text('end_date_exclusive'),
    startTz: text('start_tz'),
    endTz: text('end_tz'),
    title: text('title'),
    description: text('description'),
    location: text('location'),
    htmlLink: text('html_link'),
    recurringEventId: text('recurring_event_id'),
    originalStartTime: text('original_start_time'),
    googleUpdatedAt: text('google_updated_at'),
    // Phase 7 — local-first WRITE queue. A row is "dirty" when it holds an
    // unpushed local mutation; `pendingOp` describes the intended mutation.
    // A dirty row with pending_op='delete' is a tombstone: hidden from reads,
    // retained until we push the DELETE (or Google confirms it's gone).
    // `mutationId` is a stable client-generated nonce stored in the Google
    // event's extendedProperties.private so retries + sync can reconcile
    // without creating duplicates.
    localDirty: integer('local_dirty', { mode: 'boolean' }).notNull().default(false),
    pendingOp: text('pending_op', { enum: ['create', 'update', 'delete'] }),
    mutationId: text('mutation_id'),
    lastPushError: text('last_push_error'),
    lastPushAttemptAt: text('last_push_attempt_at'),
    // Remote changed underneath us between our base etag and our write.
    // Non-null while a conflict is unresolved; JSON of the local attempt.
    conflictPayload: text('conflict_payload'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (t) => ({
    byListEvent: uniqueIndex('calendar_events_list_event_idx').on(
      t.calendarListId,
      t.googleEventId
    ),
    byListStart: index('calendar_events_list_start_idx').on(t.calendarListId, t.startAt),
    byListDate: index('calendar_events_list_date_idx').on(t.calendarListId, t.startDate),
    byDirty: index('calendar_events_dirty_idx').on(t.localDirty),
    byMutation: index('calendar_events_mutation_idx').on(t.mutationId),
  })
);

// ---------------------------------------------------------------------------
// Phase 9 — GitHub account connection.
//
// Per-user GitHub OAuth device-flow token, encrypted at rest with the same
// key used for Google refresh tokens. Used exclusively by the Copilot AI
// provider: the GitHub access token is exchanged for a short-lived Copilot
// session token on each sync window.
// ---------------------------------------------------------------------------

export const githubAccounts = sqliteTable(
  'github_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    githubUserId: integer('github_user_id').notNull(),
    githubLogin: text('github_login').notNull(),
    accessTokenEnc: text('access_token_enc').notNull(),
    scopes: text('scopes').notNull().default(''),
    status: text('status', { enum: ['active', 'disabled'] }).notNull().default('active'),
    lastError: text('last_error'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (t) => ({
    byUser: uniqueIndex('github_accounts_user_idx').on(t.userId),
    byGithub: uniqueIndex('github_accounts_github_id_idx').on(t.githubUserId),
  })
);

// ---------------------------------------------------------------------------
// Phase 9 — AI assistant transcripts.
//
// One row per AI interaction (parse or execute). Stored for debugging and
// for the "recent prompts" history panel. `toolCallsJson` is the JSON-encoded
// ToolCall[] returned by the provider; `outcomeJson` is a per-call array of
// {ok, entityId?, error?} recorded at execute time (null for parse-only rows).
// ---------------------------------------------------------------------------

export const aiTranscripts = sqliteTable(
  'ai_transcripts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    prompt: text('prompt').notNull(),
    toolCallsJson: text('tool_calls_json').notNull(),
    outcomeJson: text('outcome_json'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  },
  (t) => ({
    byUserCreated: index('ai_transcripts_user_created_idx').on(t.userId, t.createdAt),
  })
);
