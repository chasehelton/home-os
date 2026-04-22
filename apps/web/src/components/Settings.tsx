import { useEffect, useState } from 'react';

interface CalendarRow {
  id: string;
  googleCalendarId: string;
  summary: string;
  primary: boolean;
  selected: boolean;
}

interface AccountRow {
  id: string;
  email: string;
  status: 'active' | 'disabled';
  lastError: string | null;
  calendars: CalendarRow[];
}

export function Settings() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/calendar/accounts', { credentials: 'include' });
      if (!res.ok) throw new Error(`list failed (${res.status})`);
      const body = (await res.json()) as { accounts: AccountRow[] };
      setAccounts(body.accounts);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function syncNow() {
    setBusy('sync');
    try {
      await fetch('/api/calendar/sync', { method: 'POST', credentials: 'include' });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(id: string) {
    if (!confirm('Disconnect this Google account from home-os?')) return;
    setBusy(id);
    try {
      await fetch(`/api/calendar/accounts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between">
        <h2 className="text-2xl font-semibold">Settings</h2>
      </header>

      <div className="flex flex-col gap-3 rounded border border-slate-800 bg-slate-900/40 p-5">
        <h3 className="text-lg font-medium">Google Calendar</h3>
        <p className="text-sm text-slate-400">
          Read-only sync of your Google calendars. Events refresh automatically every few minutes.
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          <a
            href="/auth/google/calendar/connect"
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500"
          >
            Connect Google Calendar
          </a>
          <button
            onClick={() => void syncNow()}
            disabled={busy !== null || accounts.length === 0}
            className="rounded bg-slate-700 px-4 py-2 text-sm hover:bg-slate-600 disabled:opacity-50"
          >
            {busy === 'sync' ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </div>

      {error && <div className="rounded bg-red-900/40 p-3 text-sm text-red-200">{error}</div>}

      {loading ? (
        <div className="text-slate-400">Loading…</div>
      ) : accounts.length === 0 ? (
        <div className="text-slate-400">No calendar accounts connected yet.</div>
      ) : (
        <ul className="flex flex-col gap-3">
          {accounts.map((a) => (
            <li
              key={a.id}
              className="flex flex-col gap-2 rounded border border-slate-800 bg-slate-900/40 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{a.email}</div>
                  <div className="text-xs text-slate-400">
                    Status: {a.status}
                    {a.lastError ? ` · last error: ${a.lastError}` : ''}
                  </div>
                </div>
                <button
                  onClick={() => void disconnect(a.id)}
                  disabled={busy !== null}
                  className="rounded bg-red-800 px-3 py-1 text-xs hover:bg-red-700 disabled:opacity-50"
                >
                  {busy === a.id ? 'Removing…' : 'Disconnect'}
                </button>
              </div>
              {a.calendars.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm text-slate-300">
                  {a.calendars.map((c) => (
                    <li key={c.id} className="flex items-center gap-2">
                      <span className="text-slate-500">•</span>
                      <span>{c.summary}</span>
                      {c.primary && (
                        <span className="rounded bg-slate-800 px-1.5 text-xs text-slate-400">
                          primary
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
