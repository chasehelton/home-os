import { useEffect, useState } from 'react';
import type { Reminder } from '@home-os/shared';

type Scope = 'household' | 'user';

export function Reminders() {
  const [rows, setRows] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [scope, setScope] = useState<Scope>('user');
  const [fireAt, setFireAt] = useState(() => defaultFireAt());
  const [busy, setBusy] = useState(false);
  const [includeDismissed, setIncludeDismissed] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (includeDismissed) q.set('includeDismissed', 'true');
      const res = await fetch(`/api/reminders?${q.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`list failed (${res.status})`);
      const body = (await res.json()) as { reminders: Reminder[] };
      setRows(body.reminders);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // load() uses includeDismissed from the closure; the ESLint React hooks
    // plugin isn't installed in this repo, but we keep the effect minimal.
  }, [includeDismissed]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !fireAt) return;
    setBusy(true);
    try {
      const iso = localInputToIso(fireAt);
      const res = await fetch('/api/reminders', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope,
          title: title.trim(),
          body: body.trim() || null,
          fireAt: iso,
        }),
      });
      if (!res.ok) throw new Error(`create failed (${res.status})`);
      setTitle('');
      setBody('');
      setFireAt(defaultFireAt());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'create failed');
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string) {
    if (!confirm('Delete this reminder?')) return;
    await fetch(`/api/reminders/${id}`, { method: 'DELETE', credentials: 'include' });
    await load();
  }
  async function dismiss(id: string) {
    await fetch(`/api/reminders/${id}/dismiss`, { method: 'POST', credentials: 'include' });
    await load();
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between">
        <h2 className="text-2xl font-semibold">Reminders</h2>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input
            type="checkbox"
            checked={includeDismissed}
            onChange={(e) => setIncludeDismissed(e.target.checked)}
          />
          Show dismissed
        </label>
      </header>

      <form
        onSubmit={(e) => void create(e)}
        className="flex flex-col gap-3 rounded border border-slate-800 bg-slate-900/40 p-4"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Remind me to…"
          className="rounded bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-600"
          required
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Optional details"
          rows={2}
          className="rounded bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-600"
        />
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col text-xs text-slate-400">
            When
            <input
              type="datetime-local"
              value={fireAt}
              onChange={(e) => setFireAt(e.target.value)}
              className="mt-1 rounded bg-slate-800 px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="flex flex-col text-xs text-slate-400">
            Scope
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
              className="mt-1 rounded bg-slate-800 px-3 py-2 text-sm"
            >
              <option value="user">Just me</option>
              <option value="household">Household</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={busy}
            className="self-end rounded bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Schedule reminder'}
          </button>
        </div>
      </form>

      {error && <div className="rounded bg-red-900/40 p-3 text-sm text-red-200">{error}</div>}

      {loading ? (
        <div className="text-slate-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-slate-400">No reminders scheduled.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded border border-slate-800 bg-slate-900/40 p-3"
            >
              <div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{r.title}</span>
                  <span
                    className={`rounded px-1.5 text-xs ${
                      r.scope === 'household'
                        ? 'bg-indigo-900 text-indigo-200'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {r.scope}
                  </span>
                  <span
                    className={`rounded px-1.5 text-xs ${statusColor(r.status)}`}
                    title={r.firedAt ?? undefined}
                  >
                    {r.status}
                  </span>
                </div>
                <div className="text-xs text-slate-400">{formatLocal(r.fireAt)}</div>
                {r.body && <div className="mt-1 text-sm text-slate-300">{r.body}</div>}
              </div>
              <div className="flex gap-2">
                {r.status === 'fired' && (
                  <button
                    onClick={() => void dismiss(r.id)}
                    className="rounded bg-slate-700 px-3 py-1 text-xs hover:bg-slate-600"
                  >
                    Dismiss
                  </button>
                )}
                <button
                  onClick={() => void del(r.id)}
                  className="rounded bg-red-800 px-3 py-1 text-xs hover:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function defaultFireAt(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return toLocalInputValue(d);
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(v: string): string {
  // Interpret the datetime-local value in the browser's local zone and
  // serialize as ISO-8601 with explicit offset so the server receives
  // an offset-aware timestamp.
  const d = new Date(v);
  const tzOffsetMin = -d.getTimezoneOffset();
  const sign = tzOffsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(tzOffsetMin);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const hh = pad(Math.floor(abs / 60));
  const mm = pad(abs % 60);
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  return `${base}${sign}${hh}:${mm}`;
}

function formatLocal(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function statusColor(status: string): string {
  if (status === 'fired') return 'bg-amber-900 text-amber-200';
  if (status === 'dismissed') return 'bg-slate-800 text-slate-400';
  if (status === 'cancelled') return 'bg-slate-800 text-slate-500';
  return 'bg-emerald-900 text-emerald-200';
}
