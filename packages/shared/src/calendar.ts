import { z } from 'zod';

const Id = z.string().min(1).max(64);
const IsoDateTime = z.string().datetime({ offset: true });
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const CalendarAccountStatus = z.enum(['active', 'disabled']);
export type CalendarAccountStatus = z.infer<typeof CalendarAccountStatus>;

export const CalendarList = z.object({
  id: Id,
  accountId: Id,
  googleCalendarId: z.string(),
  summary: z.string(),
  description: z.string().nullable(),
  backgroundColor: z.string().nullable(),
  foregroundColor: z.string().nullable(),
  timeZone: z.string().nullable(),
  primary: z.boolean(),
  selected: z.boolean(),
});
export type CalendarList = z.infer<typeof CalendarList>;

export const CalendarAccount = z.object({
  id: Id,
  userId: Id,
  email: z.string().email(),
  status: CalendarAccountStatus,
  lastError: z.string().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  calendars: z.array(CalendarList),
});
export type CalendarAccount = z.infer<typeof CalendarAccount>;

export const CalendarEventStatus = z.enum(['confirmed', 'tentative', 'cancelled']);
export type CalendarEventStatus = z.infer<typeof CalendarEventStatus>;

export const CalendarEvent = z.object({
  id: Id,
  calendarListId: Id,
  googleEventId: z.string(),
  status: CalendarEventStatus,
  allDay: z.boolean(),
  startAt: IsoDateTime.nullable(),
  endAt: IsoDateTime.nullable(),
  startDate: IsoDate.nullable(),
  endDateExclusive: IsoDate.nullable(),
  startTz: z.string().nullable(),
  endTz: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  htmlLink: z.string().nullable(),
  recurringEventId: z.string().nullable(),
  originalStartTime: z.string().nullable(),
  // Phase 7 write-queue state (optional for back-compat with READ-only clients).
  localDirty: z.boolean().optional(),
  pendingOp: z.enum(['create', 'update', 'delete']).nullable().optional(),
  hasConflict: z.boolean().optional(),
  lastPushError: z.string().nullable().optional(),
});
export type CalendarEvent = z.infer<typeof CalendarEvent>;

const OptionalIsoDateTime = IsoDateTime.nullable().optional();
const OptionalIsoDate = IsoDate.nullable().optional();
const OptionalString = z.string().nullable().optional();

/**
 * Zod schema for creating a calendar event. The caller is responsible for
 * choosing either the timed shape (startAt/endAt) or the all-day shape
 * (startDate/endDateExclusive) — server validates the combination.
 */
export const CalendarEventCreate = z
  .object({
    calendarListId: Id,
    title: z.string().min(1).max(1024),
    description: OptionalString,
    location: OptionalString,
    status: z.enum(['confirmed', 'tentative']).optional(),
    allDay: z.boolean(),
    startAt: OptionalIsoDateTime,
    endAt: OptionalIsoDateTime,
    startDate: OptionalIsoDate,
    endDateExclusive: OptionalIsoDate,
    startTz: OptionalString,
    endTz: OptionalString,
  })
  .strict();
export type CalendarEventCreate = z.infer<typeof CalendarEventCreate>;

export const CalendarEventUpdate = z
  .object({
    title: z.string().min(1).max(1024).optional(),
    description: OptionalString,
    location: OptionalString,
    status: z.enum(['confirmed', 'tentative']).optional(),
    allDay: z.boolean().optional(),
    startAt: OptionalIsoDateTime,
    endAt: OptionalIsoDateTime,
    startDate: OptionalIsoDate,
    endDateExclusive: OptionalIsoDate,
    startTz: OptionalString,
    endTz: OptionalString,
  })
  .strict();
export type CalendarEventUpdate = z.infer<typeof CalendarEventUpdate>;

export const ListCalendarEventsQuery = z.object({
  from: IsoDate,
  to: IsoDate,
  scope: z.enum(['self', 'household']).default('self'),
});
export type ListCalendarEventsQuery = z.infer<typeof ListCalendarEventsQuery>;

export const HouseholdMember = z.object({
  id: z.string(),
  displayName: z.string(),
  color: z.string().nullable(),
  pictureUrl: z.string().nullable(),
});
export type HouseholdMember = z.infer<typeof HouseholdMember>;
