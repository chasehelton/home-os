import { useEffect, useMemo, useState } from 'react';
import { Button } from './ui/Button';
import { Field as UiField, Input, Textarea } from './ui/Input';
import { SegmentedTabs } from './ui/Tabs';
import { Dialog } from './ui/Dialog';
import { cn } from './ui/cn';

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

interface EventRow {
  id: string;
  calendarListId: string;
  googleEventId?: string;
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
  ownerUserId?: string;
  ownerDisplayName?: string;
  ownerColor?: string | null;
  // Phase 7 write-queue state.
  localDirty?: boolean;
  pendingOp?: 'create' | 'update' | 'delete' | null;
  hasConflict?: boolean;
  lastPushError?: string | null;
}

interface PrimaryCalendar {
  accountId: string;
  calendarListId: string;
  canWrite: boolean;
  email: string;
}

interface HouseholdMember {
  id: string;
  displayName: string;
  color: string | null;
  pictureUrl: string | null;
}

type ViewMode = 'agenda' | 'week' | 'day';
type Scope = 'self' | 'household';

type EditorState = null | { mode: 'create'; anchorDate: Date } | { mode: 'edit'; event: EventRow };

interface CalendarProps {
  currentUserId: string;
}

// -------------------------------------------------------------------------
// Date helpers — everything computed in the browser's local zone so that
// "Week of ..." matches the user's wall clock. Events arrive as UTC ISO
// from the API; `new Date(iso)` handles the local-zone conversion.
// -------------------------------------------------------------------------

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

/** Sunday-start week. Returns the Sunday on or before `d`. */
function startOfWeek(d: Date): Date {
  return addDays(d, -d.getDay());
}

function sameYmd(a: Date, b: Date): boolean {
  return toYmd(a) === toYmd(b);
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatRangeLabel(view: ViewMode, anchor: Date): string {
  if (view === 'day') {
    return anchor.toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  if (view === 'week') {
    const s = startOfWeek(anchor);
    const e = addDays(s, 6);
    return `${s.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  // agenda: 30-day rolling window from anchor
  const e = addDays(anchor, 30);
  return `${anchor.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

function windowFor(view: ViewMode, anchor: Date): { from: string; to: string } {
  if (view === 'day') return { from: toYmd(anchor), to: toYmd(anchor) };
  if (view === 'week') {
    const s = startOfWeek(anchor);
    return { from: toYmd(s), to: toYmd(addDays(s, 6)) };
  }
  return { from: toYmd(anchor), to: toYmd(addDays(anchor, 30)) };
}

// -------------------------------------------------------------------------
// URL state — ?tab=calendar&view=week&date=YYYY-MM-DD&scope=household
// -------------------------------------------------------------------------

function readUrlState(): { view: ViewMode; anchor: Date; scope: Scope } {
  const p = new URLSearchParams(window.location.search);
  const v = p.get('view');
  const view: ViewMode = v === 'week' || v === 'day' || v === 'agenda' ? v : 'week';
  const d = p.get('date');
  const anchor = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? parseYmd(d) : new Date();
  const s = p.get('scope');
  const scope: Scope = s === 'household' ? 'household' : 'self';
  return { view, anchor, scope };
}

function writeUrlState(view: ViewMode, anchor: Date, scope: Scope) {
  const p = new URLSearchParams(window.location.search);
  p.set('tab', 'calendar');
  p.set('view', view);
  p.set('date', toYmd(anchor));
  p.set('scope', scope);
  const next = `${window.location.pathname}?${p.toString()}`;
  window.history.replaceState(null, '', next);
}

// -------------------------------------------------------------------------
// Owner-color helper — colors are whatever `users.color` stores (CSS color
// string) or a stable fallback hash. Supports colorblind-friendly text cue:
// event chips always include the owner's name when scope=household.
// -------------------------------------------------------------------------

const FALLBACK_COLORS = ['#7a7555', '#805604', '#48605f', '#a66b4a', '#5a6e3c', '#8e5b7a'];
function hashColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length]!;
}

function colorFor(ownerUserId: string | undefined, members: HouseholdMember[]): string {
  if (!ownerUserId) return '#7a7555';
  const m = members.find((x) => x.id === ownerUserId);
  return m?.color || hashColor(ownerUserId);
}

// -------------------------------------------------------------------------
// Main component
// -------------------------------------------------------------------------

export function Calendar({ currentUserId }: CalendarProps) {
  const initial = readUrlState();
  const [view, setView] = useState<ViewMode>(initial.view);
  const [anchor, setAnchor] = useState<Date>(initial.anchor);
  const [scope, setScope] = useState<Scope>(initial.scope);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [primary, setPrimary] = useState<PrimaryCalendar | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    writeUrlState(view, anchor, scope);
  }, [view, anchor, scope]);

  useEffect(() => {
    void fetch('/api/household/members', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((b: { members: HouseholdMember[] }) => setMembers(b.members));
  }, []);

  // Load the current user's primary calendar once. This powers both the
  // "New event" button (needs calendarListId) and the reconnect banner.
  useEffect(() => {
    void fetch('/api/calendar/accounts', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { accounts: [] }))
      .then(
        (b: {
          accounts: Array<{
            id: string;
            email: string;
            canWrite: boolean;
            calendars: Array<{ id: string; primary: boolean }>;
          }>;
        }) => {
          const mine = b.accounts[0];
          if (!mine) return setPrimary(null);
          const p = mine.calendars.find((c) => c.primary);
          if (!p) return setPrimary(null);
          setPrimary({
            accountId: mine.id,
            calendarListId: p.id,
            canWrite: mine.canWrite,
            email: mine.email,
          });
        },
      );
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const { from, to } = windowFor(view, anchor);
    const url = `/api/calendar/events?from=${from}&to=${to}&scope=${scope}`;
    fetch(url, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error(`events ${r.status}`);
        return r.json();
      })
      .then((b: { events: EventRow[] }) => {
        if (!alive) return;
        // Hide cancelled events from the UI.
        setEvents(b.events.filter((e) => e.status !== 'cancelled'));
        setError(null);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'load failed');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [view, anchor, scope, reloadTick]);

  // Filter out events owned by hidden users (only applies when scope=household).
  const visible = useMemo(
    () =>
      events.filter((e) => {
        const owner = e.ownerUserId ?? currentUserId;
        return !hidden.has(owner);
      }),
    [events, hidden, currentUserId],
  );

  function toggleHidden(userId: string) {
    setHidden((prev) => {
      const n = new Set(prev);
      if (n.has(userId)) n.delete(userId);
      else n.add(userId);
      return n;
    });
  }

  function shift(days: number) {
    if (view === 'week') setAnchor((d) => addDays(d, days * 7));
    else setAnchor((d) => addDays(d, days));
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-surface">
      <header className="flex flex-wrap items-center gap-3 border-b border-outline-variant/60 bg-surface/60 px-4 py-3 backdrop-blur md:px-margin">
        <SegmentedTabs<ViewMode>
          value={view}
          onChange={setView}
          tabs={[
            { id: 'agenda', label: 'Agenda' },
            { id: 'week', label: 'Week' },
            { id: 'day', label: 'Day' },
          ]}
          size="sm"
        />
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => shift(-1)} aria-label="Previous">
            ←
          </Button>
          <Button size="sm" variant="tonal" onClick={() => setAnchor(new Date())}>
            Today
          </Button>
          <Button size="sm" variant="outline" onClick={() => shift(1)} aria-label="Next">
            →
          </Button>
        </div>
        <div className="text-body-md text-on-surface-variant">{formatRangeLabel(view, anchor)}</div>
        <div className="ml-auto flex items-center gap-2">
          <SegmentedTabs<Scope>
            value={scope}
            onChange={setScope}
            tabs={[
              { id: 'self', label: 'Mine' },
              { id: 'household', label: 'Everyone' },
            ]}
            size="sm"
          />
          {primary?.canWrite && (
            <Button size="sm" onClick={() => setEditor({ mode: 'create', anchorDate: anchor })}>
              + New event
            </Button>
          )}
        </div>
      </header>

      {primary && !primary.canWrite && (
        <div className="border-b border-outline-variant/60 bg-secondary-container px-4 py-2 text-body-md text-secondary-on-container md:px-margin">
          Reconnect Google to enable creating & editing events.{' '}
          <a className="underline underline-offset-2" href="/auth/google/calendar/connect">
            Reconnect
          </a>
        </div>
      )}

      {scope === 'household' && members.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-outline-variant/60 bg-surface-container-low/70 px-4 py-2 text-label-md md:px-margin">
          {members.map((m) => {
            const off = hidden.has(m.id);
            const color = m.color || hashColor(m.id);
            return (
              <button
                key={m.id}
                onClick={() => toggleHidden(m.id)}
                className={cn(
                  'flex items-center gap-2 rounded-full bg-surface-lowest px-3 py-1 shadow-ambient transition-all duration-200 ease-soft hover:-translate-y-px',
                  off && 'opacity-40',
                )}
                title={off ? `Show ${m.displayName}` : `Hide ${m.displayName}`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-on-surface">{m.displayName}</span>
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <div className="border-b border-outline-variant/60 bg-danger-container px-4 py-2 text-body-md text-danger-on-container md:px-margin">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="p-6 text-body-md text-on-surface-variant">Loading…</div>
        ) : view === 'agenda' ? (
          <AgendaView
            events={visible}
            members={members}
            scope={scope}
            anchor={anchor}
            currentUserId={currentUserId}
            onOpenEvent={(e) => setEditor({ mode: 'edit', event: e })}
          />
        ) : view === 'week' ? (
          <WeekView
            events={visible}
            members={members}
            scope={scope}
            anchor={anchor}
            days={7}
            currentUserId={currentUserId}
            onOpenEvent={(e) => setEditor({ mode: 'edit', event: e })}
          />
        ) : (
          <WeekView
            events={visible}
            members={members}
            scope={scope}
            anchor={anchor}
            days={1}
            currentUserId={currentUserId}
            onOpenEvent={(e) => setEditor({ mode: 'edit', event: e })}
          />
        )}
      </div>

      {editor && primary?.canWrite && (
        <EventEditor
          state={editor}
          primary={primary}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            setReloadTick((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}

// -------------------------------------------------------------------------
// Agenda — flat list grouped by local-day header
// -------------------------------------------------------------------------

function AgendaView({
  events,
  members,
  scope,
  anchor,
  currentUserId,
  onOpenEvent,
}: {
  events: EventRow[];
  members: HouseholdMember[];
  scope: Scope;
  anchor: Date;
  currentUserId: string;
  onOpenEvent: (e: EventRow) => void;
}) {
  // Expand each event into (date, chip) pairs so all-day spans show up on
  // each day they cover.
  const byDay = new Map<string, Array<{ event: EventRow; sortKey: number; label: string }>>();
  const windowStart = anchor;
  const windowEnd = addDays(anchor, 30);

  for (const e of events) {
    if (e.allDay && e.startDate && e.endDateExclusive) {
      let d = parseYmd(e.startDate);
      const end = parseYmd(e.endDateExclusive);
      while (d < end) {
        if (d >= addDays(windowStart, -1) && d <= windowEnd) {
          const k = toYmd(d);
          if (!byDay.has(k)) byDay.set(k, []);
          byDay.get(k)!.push({ event: e, sortKey: -1, label: 'All day' });
        }
        d = addDays(d, 1);
      }
    } else if (e.startAt) {
      const start = new Date(e.startAt);
      const end = e.endAt ? new Date(e.endAt) : start;
      const k = toYmd(start);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k)!.push({
        event: e,
        sortKey: start.getTime(),
        label: `${formatTime(start)} – ${formatTime(end)}`,
      });
    }
  }
  const keys = [...byDay.keys()].sort();

  if (keys.length === 0) {
    return <div className="p-6 text-body-md text-on-surface-variant">Nothing on the calendar.</div>;
  }

  return (
    <ul className="flex w-full flex-col">
      {keys.map((k) => {
        const day = parseYmd(k);
        const items = byDay.get(k)!.sort((a, b) => a.sortKey - b.sortKey);
        return (
          <li key={k} className="border-b border-outline-variant/60">
            <div className="bg-surface-container-low px-4 py-2 text-label-sm text-on-surface-variant md:px-margin">
              {day.toLocaleDateString([], {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
              })}
            </div>
            <ul className="flex flex-col">
              {items.map(({ event, label }, i) => {
                const color = colorFor(event.ownerUserId, members);
                const editable = isEditable(event, currentUserId);
                return (
                  <li
                    key={`${event.id}-${i}`}
                    className={cn(
                      'flex items-center gap-3 border-l-4 px-4 py-2.5 transition-colors duration-200 ease-soft hover:bg-surface-container-low md:px-margin',
                      editable && 'cursor-pointer',
                      event.hasConflict && 'bg-danger-container/50',
                    )}
                    style={{ borderLeftColor: color }}
                    onClick={() => {
                      if (editable) onOpenEvent(event);
                      else if (event.htmlLink) window.open(event.htmlLink, '_blank', 'noopener');
                    }}
                  >
                    <span className="w-36 shrink-0 text-label-md text-on-surface-variant">
                      {label}
                    </span>
                    <span className="flex-1 text-body-md text-on-surface">
                      {event.title || '(no title)'}
                    </span>
                    <EventBadges event={event} />
                    {event.location && (
                      <span className="hidden max-w-[20ch] truncate text-label-md text-on-surface-variant sm:inline">
                        {event.location}
                      </span>
                    )}
                    {scope === 'household' && event.ownerDisplayName && (
                      <span className="rounded-full bg-surface-container px-2.5 py-0.5 text-label-sm text-on-surface-variant">
                        {event.ownerDisplayName}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

// -------------------------------------------------------------------------
// Week / Day — time grid with all-day lane
// -------------------------------------------------------------------------

const PX_PER_HOUR = 48;
const HOURS_TOTAL = 24;

function WeekView({
  events,
  members,
  scope,
  anchor,
  days,
  currentUserId,
  onOpenEvent,
}: {
  events: EventRow[];
  members: HouseholdMember[];
  scope: Scope;
  anchor: Date;
  days: number;
  currentUserId: string;
  onOpenEvent: (e: EventRow) => void;
}) {
  const start = days === 7 ? startOfWeek(anchor) : anchor;
  const dayDates = Array.from({ length: days }, (_, i) => addDays(start, i));

  // Partition events by all-day vs timed per-day.
  const allDayByDay = new Map<string, EventRow[]>();
  const timedByDay = new Map<string, EventRow[]>();
  for (const d of dayDates) allDayByDay.set(toYmd(d), []);
  for (const d of dayDates) timedByDay.set(toYmd(d), []);

  for (const e of events) {
    if (e.allDay && e.startDate && e.endDateExclusive) {
      const s = parseYmd(e.startDate);
      const en = parseYmd(e.endDateExclusive);
      for (const d of dayDates) {
        if (d >= s && d < en) allDayByDay.get(toYmd(d))!.push(e);
      }
    } else if (e.startAt && e.endAt) {
      const s = new Date(e.startAt);
      const en = new Date(e.endAt);
      for (const d of dayDates) {
        const dayStart = new Date(d);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = addDays(dayStart, 1);
        // overlap with this local day
        if (s < dayEnd && en > dayStart) {
          timedByDay.get(toYmd(d))!.push(e);
        }
      }
    }
  }

  return (
    <div className="flex w-full flex-col">
      {/* Day headers */}
      <div
        className="grid border-b border-outline-variant/60 text-label-sm"
        style={{ gridTemplateColumns: `3.5rem repeat(${days}, minmax(0, 1fr))` }}
      >
        <div />
        {dayDates.map((d) => {
          const isToday = sameYmd(d, new Date());
          return (
            <div
              key={toYmd(d)}
              className={cn(
                'px-2 py-2 text-center',
                isToday ? 'bg-primary-container/60 text-primary-on-container' : 'text-on-surface-variant',
              )}
            >
              <div>{d.toLocaleDateString([], { weekday: 'short' })}</div>
              <div
                className={cn(
                  'font-display text-headline-md',
                  isToday ? 'text-primary-on-container' : 'text-on-surface',
                )}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* All-day lane */}
      <div
        className="grid border-b border-outline-variant/60 bg-surface-container-low/40"
        style={{ gridTemplateColumns: `3.5rem repeat(${days}, minmax(0, 1fr))` }}
      >
        <div className="px-2 py-1 text-right text-label-sm text-on-surface-variant/80">all day</div>
        {dayDates.map((d) => {
          const items = allDayByDay.get(toYmd(d))!;
          return (
            <div key={toYmd(d)} className="flex min-h-[28px] flex-col gap-0.5 p-1">
              {items.map((e) => (
                <EventChip
                  key={`${e.id}-${toYmd(d)}`}
                  event={e}
                  members={members}
                  scope={scope}
                  compact
                  currentUserId={currentUserId}
                  onOpenEvent={onOpenEvent}
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* Timed grid */}
      <div
        className="relative grid"
        style={{
          gridTemplateColumns: `3.5rem repeat(${days}, minmax(0, 1fr))`,
          height: `${PX_PER_HOUR * HOURS_TOTAL}px`,
        }}
      >
        {/* hour gutter */}
        <div className="relative border-r border-outline-variant/40">
          {Array.from({ length: HOURS_TOTAL }, (_, h) => (
            <div
              key={h}
              className="absolute right-1 -translate-y-1/2 text-label-sm text-on-surface-variant/70"
              style={{ top: `${h * PX_PER_HOUR}px` }}
            >
              {h === 0 ? '' : `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`}
            </div>
          ))}
        </div>

        {/* day columns */}
        {dayDates.map((d) => {
          const items = timedByDay.get(toYmd(d))!;
          const isToday = sameYmd(d, new Date());
          return (
            <div
              key={toYmd(d)}
              className={cn(
                'relative border-r border-outline-variant/40',
                isToday && 'bg-primary-container/15',
              )}
            >
              {/* hour lines */}
              {Array.from({ length: HOURS_TOTAL }, (_, h) => (
                <div
                  key={h}
                  className="absolute inset-x-0 border-t border-outline-variant/30"
                  style={{ top: `${h * PX_PER_HOUR}px` }}
                />
              ))}
              {/* current-time indicator */}
              {isToday && <NowLine />}
              {/* events positioned by real minute */}
              {items.map((e) => {
                const s = new Date(e.startAt!);
                const en = new Date(e.endAt!);
                const dayStart = new Date(d);
                dayStart.setHours(0, 0, 0, 0);
                const dayEnd = addDays(dayStart, 1);
                const top =
                  Math.max(0, (s.getTime() - dayStart.getTime()) / 3_600_000) * PX_PER_HOUR;
                const bottom =
                  Math.min(HOURS_TOTAL, (en.getTime() - dayStart.getTime()) / 3_600_000) *
                  PX_PER_HOUR;
                const height = Math.max(18, bottom - top);
                const clippedLeft = s < dayStart;
                const clippedRight = en > dayEnd;
                return (
                  <div
                    key={`${e.id}-${toYmd(d)}`}
                    className="absolute inset-x-1"
                    style={{ top: `${top}px`, height: `${height}px` }}
                  >
                    <EventChip
                      event={e}
                      members={members}
                      scope={scope}
                      currentUserId={currentUserId}
                      onOpenEvent={onOpenEvent}
                      timeLabel={`${clippedLeft ? '…' : formatTime(s)} – ${
                        clippedRight ? '…' : formatTime(en)
                      }`}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NowLine() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const h = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(h);
  }, []);
  const ms = now.getHours() * 3_600_000 + now.getMinutes() * 60_000;
  const top = (ms / 3_600_000) * PX_PER_HOUR;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-danger"
      style={{ top: `${top}px` }}
    >
      <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-danger" />
    </div>
  );
}

function EventChip({
  event,
  members,
  scope,
  timeLabel,
  compact,
  currentUserId,
  onOpenEvent,
}: {
  event: EventRow;
  members: HouseholdMember[];
  scope: Scope;
  timeLabel?: string;
  compact?: boolean;
  currentUserId: string;
  onOpenEvent: (e: EventRow) => void;
}) {
  const color = colorFor(event.ownerUserId, members);
  const editable = isEditable(event, currentUserId);
  return (
    <div
      className={cn(
        'h-full cursor-pointer overflow-hidden rounded-sm border-l-4 shadow-ambient transition-colors duration-200 ease-soft',
        compact ? 'px-1.5 py-0.5 text-label-sm' : 'p-1.5 text-label-md',
        event.hasConflict
          ? 'bg-danger-container ring-1 ring-danger'
          : 'bg-surface-lowest hover:bg-surface-container',
      )}
      style={{ borderLeftColor: color }}
      title={event.title ?? ''}
      onClick={() => {
        if (editable) onOpenEvent(event);
        else if (event.htmlLink) window.open(event.htmlLink, '_blank', 'noopener');
      }}
    >
      <div className="flex items-center gap-1">
        <div className="flex-1 truncate font-medium text-on-surface">
          {event.title || '(no title)'}
        </div>
        <EventBadges event={event} />
      </div>
      {!compact && timeLabel && (
        <div className="truncate text-label-sm text-on-surface-variant">{timeLabel}</div>
      )}
      {scope === 'household' && event.ownerDisplayName && (
        <div className="truncate text-label-sm text-on-surface-variant">
          · {event.ownerDisplayName}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------------
// Phase 7 — write helpers, badges, and editor modal
// -------------------------------------------------------------------------

function isEditable(event: EventRow, currentUserId: string): boolean {
  if (event.recurringEventId) return false;
  if (event.ownerUserId && event.ownerUserId !== currentUserId) return false;
  return true;
}

function EventBadges({ event }: { event: EventRow }) {
  if (event.hasConflict) {
    return (
      <span
        className="shrink-0 rounded-full bg-danger px-2 py-0.5 text-label-sm text-danger-on"
        title={event.lastPushError ?? 'conflict with Google'}
      >
        conflict
      </span>
    );
  }
  if (event.localDirty) {
    return (
      <span
        className="shrink-0 rounded-full bg-surface-container px-2 py-0.5 text-label-sm text-on-surface-variant"
        title={`Pending ${event.pendingOp ?? 'sync'}${
          event.lastPushError ? ` — ${event.lastPushError}` : ''
        }`}
      >
        syncing
      </span>
    );
  }
  return null;
}

// Build a local-YYYY-MM-DDTHH:MM string for <input type="datetime-local">.
function toLocalInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function fromLocalInput(s: string): Date {
  // `new Date('YYYY-MM-DDTHH:MM')` in browsers parses as local time.
  return new Date(s);
}

function addDaysYmd(ymd: string, days: number): string {
  return toYmd(addDays(parseYmd(ymd), days));
}

function EventEditor({
  state,
  primary,
  onClose,
  onSaved,
}: {
  state: Exclude<EditorState, null>;
  primary: PrimaryCalendar;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = state.mode === 'edit' ? state.event : null;

  const initialAllDay = existing ? existing.allDay : false;
  const [allDay, setAllDay] = useState(initialAllDay);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [location, setLocation] = useState(existing?.location ?? '');

  // Seed start/end. For create mode, default to 9:00–10:00 on the anchor day.
  const seedStart = existing?.startAt
    ? new Date(existing.startAt)
    : (() => {
        const d = new Date(state.mode === 'create' ? state.anchorDate : new Date());
        d.setHours(9, 0, 0, 0);
        return d;
      })();
  const seedEnd = existing?.endAt
    ? new Date(existing.endAt)
    : new Date(seedStart.getTime() + 60 * 60 * 1000);

  const [startLocal, setStartLocal] = useState(toLocalInput(seedStart));
  const [endLocal, setEndLocal] = useState(toLocalInput(seedEnd));

  const seedStartDate =
    existing?.startDate ?? toYmd(state.mode === 'create' ? state.anchorDate : new Date());
  const seedEndDate = existing?.endDateExclusive ?? addDaysYmd(seedStartDate, 1);
  const [startDate, setStartDate] = useState(seedStartDate);
  // Input holds *inclusive* end date; convert to exclusive on submit.
  const [endDateInclusive, setEndDateInclusive] = useState(addDaysYmd(seedEndDate, -1));

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim() || undefined,
        location: location.trim() || undefined,
        allDay,
      };
      if (allDay) {
        body.startDate = startDate;
        body.endDateExclusive = addDaysYmd(endDateInclusive, 1);
      } else {
        body.startAt = fromLocalInput(startLocal).toISOString();
        body.endAt = fromLocalInput(endLocal).toISOString();
      }
      let url: string;
      let method: string;
      if (existing) {
        url = `/api/calendar/events/${existing.id}`;
        method = 'PATCH';
      } else {
        url = '/api/calendar/events';
        method = 'POST';
        body.calendarListId = primary.calendarListId;
      }
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `save failed (${res.status})`);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function del() {
    if (!existing) return;
    if (!window.confirm('Delete this event?')) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/calendar/events/${existing.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok && res.status !== 204) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `delete failed (${res.status})`);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'delete failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function discard() {
    if (!existing) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/calendar/events/${existing.id}/discard-conflict`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`discard failed (${res.status})`);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'discard failed');
    } finally {
      setSubmitting(false);
    }
  }

  const footer = (
    <>
      {existing && (
        <Button
          variant="danger"
          onClick={del}
          disabled={submitting}
          className="mr-auto"
        >
          Delete
        </Button>
      )}
      <Button variant="ghost" onClick={onClose} disabled={submitting}>
        Cancel
      </Button>
      <Button
        onClick={submit}
        disabled={submitting || !title.trim()}
      >
        {existing ? 'Save' : 'Create'}
      </Button>
    </>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={existing ? 'Edit event' : 'New event'}
      footer={footer}
      size="md"
    >
      {existing?.hasConflict && (
        <div className="mb-3 rounded bg-danger-container p-3 text-body-md text-danger-on-container">
          This event has a sync conflict with Google. Keep the server version and drop your local
          changes?{' '}
          <Button size="sm" variant="danger" onClick={discard} disabled={submitting} className="ml-1">
            Discard my changes
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <UiField label="Title">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </UiField>
        <label className="flex items-center gap-2 text-body-md text-on-surface">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
            className="h-4 w-4 rounded border-outline-variant accent-primary"
          />
          <span>All day</span>
        </label>
        {allDay ? (
          <div className="grid grid-cols-2 gap-3">
            <UiField label="Start date">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </UiField>
            <UiField label="End date">
              <Input
                type="date"
                value={endDateInclusive}
                onChange={(e) => setEndDateInclusive(e.target.value)}
              />
            </UiField>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <UiField label="Starts">
              <Input
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
              />
            </UiField>
            <UiField label="Ends">
              <Input
                type="datetime-local"
                value={endLocal}
                onChange={(e) => setEndLocal(e.target.value)}
              />
            </UiField>
          </div>
        )}
        <UiField label="Location">
          <Input value={location} onChange={(e) => setLocation(e.target.value)} />
        </UiField>
        <UiField label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </UiField>
      </div>

      {err && <div className="mt-3 text-body-md text-danger">{err}</div>}
    </Dialog>
  );
}
