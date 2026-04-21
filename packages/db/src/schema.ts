import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

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
