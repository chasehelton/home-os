import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// ---------------------------------------------------------------------------
// Phase 0 / 1 tables. Additional tables (recipes, meal plans, calendar, etc.)
// are added in their respective phases per plan.md.
// ---------------------------------------------------------------------------

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
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
