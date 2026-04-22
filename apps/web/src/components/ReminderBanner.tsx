import { useEffect, useState } from 'react';
import type { Reminder } from '@home-os/shared';

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
      className="flex flex-col gap-2 border-b border-amber-800 bg-amber-900/40 px-4 py-3"
    >
      {rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-amber-100">
              🔔 {r.title}
              <span className="ml-2 text-xs text-amber-300">
                {r.scope === 'household' ? 'household' : 'for you'}
              </span>
            </div>
            {r.body && <div className="text-xs text-amber-200/80">{r.body}</div>}
          </div>
          <button
            onClick={() => void dismiss(r.id)}
            className="rounded bg-amber-800 px-3 py-1 text-xs font-medium text-amber-50 hover:bg-amber-700"
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
