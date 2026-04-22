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
});
export type CalendarEvent = z.infer<typeof CalendarEvent>;

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
