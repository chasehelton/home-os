import { z } from 'zod';
import { Scope } from './scope.js';

const Id = z.string().min(1).max(64);
const IsoDateTime = z.string().datetime({ offset: true });

export const ReminderEntityType = z.enum(['todo', 'calendar_event', 'custom']);
export type ReminderEntityType = z.infer<typeof ReminderEntityType>;

export const ReminderStatus = z.enum(['pending', 'fired', 'dismissed', 'cancelled']);
export type ReminderStatus = z.infer<typeof ReminderStatus>;

export const Reminder = z.object({
  id: Id,
  scope: Scope,
  ownerUserId: Id.nullable(),
  title: z.string().min(1).max(500),
  body: z.string().max(4_000).nullable(),
  fireAt: IsoDateTime,
  status: ReminderStatus,
  entityType: ReminderEntityType.nullable(),
  entityId: z.string().max(128).nullable(),
  firedAt: IsoDateTime.nullable(),
  dismissedAt: IsoDateTime.nullable(),
  createdBy: Id,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Reminder = z.infer<typeof Reminder>;

export const CreateReminderInput = z
  .object({
    scope: Scope.default('user'),
    title: z.string().min(1).max(500),
    body: z.string().max(4_000).nullable().optional(),
    fireAt: IsoDateTime,
    entityType: ReminderEntityType.nullable().optional(),
    entityId: z.string().max(128).nullable().optional(),
    ownerUserId: Id.nullable().optional(),
  })
  .strict();
export type CreateReminderInput = z.infer<typeof CreateReminderInput>;

export const UpdateReminderInput = z
  .object({
    title: z.string().min(1).max(500).optional(),
    body: z.string().max(4_000).nullable().optional(),
    fireAt: IsoDateTime.optional(),
    scope: Scope.optional(),
    ownerUserId: Id.nullable().optional(),
    status: ReminderStatus.optional(),
  })
  .strict();
export type UpdateReminderInput = z.infer<typeof UpdateReminderInput>;

export const ListRemindersQuery = z
  .object({
    scope: z.enum(['household', 'user', 'all']).optional().default('all'),
    status: ReminderStatus.optional(),
    includeDismissed: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .optional()
      .default(false)
      .transform((v) => (typeof v === 'boolean' ? v : v === 'true')),
  })
  .strict();
export type ListRemindersQuery = z.infer<typeof ListRemindersQuery>;

// Web Push subscription payload as delivered by the browser's
// PushManager.subscribe(). We only persist endpoint + the two keys.
export const PushSubscriptionInput = z
  .object({
    endpoint: z.string().url().max(2048),
    keys: z.object({
      p256dh: z.string().min(1).max(256),
      auth: z.string().min(1).max(256),
    }),
    userAgent: z.string().max(512).nullable().optional(),
  })
  .strict();
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInput>;

export const PushUnsubscribeInput = z
  .object({
    endpoint: z.string().url().max(2048),
  })
  .strict();
export type PushUnsubscribeInput = z.infer<typeof PushUnsubscribeInput>;
