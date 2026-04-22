import { useEffect, useState } from 'react';
import type { Reminder } from '@home-os/shared';
import { Button } from './ui/Button';

interface Props {
  /** How often to poll /api/reminders/active (ms). 0 disables. */
  intervalMs?: number;
}

/**
 * Top-of-app banner for fired reminders. Polls /api/reminders/active and
 * renders dismiss buttons. This is the reliable delivery channel (push is
 * best-effort); both kiosk and mobile web inherit it via the shared shell.
 */
export function ReminderBanner({ intervalMs = 20_000 }: Props) {
  const [rows, setRows] = useState<Reminder[]>([]);

  async function refresh() {
    try {
      const res = await fetch('/api/reminders/active', { credentials: 'include' });
      if (!res.ok) return;
      const body = (await res.json()) as { reminders: Reminder[] };
      setRows(body.reminders);
    } catch {
      // silent — banner is a best-effort surface
    }
  }

  useEffect(() => {
    void refresh();
    if (intervalMs <= 0) return;
    const handle = window.setInterval(() => void refresh(), intervalMs);
    return () => window.clearInterval(handle);
  }, [intervalMs]);

  async function dismiss(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
    await fetch(`/api/reminders/${id}/dismiss`, { method: 'POST', credentials: 'include' });
  }

  if (rows.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-2 border-b border-outline-variant/60 bg-secondary-container/70 px-4 py-3 text-secondary-on-container md:px-6"
    >
      {rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-body-md font-medium">
              <span aria-hidden>🔔</span>
              <span className="truncate">{r.title}</span>
              <span className="shrink-0 text-label-sm opacity-80">
                {r.scope === 'household' ? 'household' : 'for you'}
              </span>
            </div>
            {r.body && <div className="truncate text-label-md opacity-80">{r.body}</div>}
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void dismiss(r.id)}
            className="shrink-0"
          >
            Dismiss
          </Button>
        </div>
      ))}
    </div>
  );
}
