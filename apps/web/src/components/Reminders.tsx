import { useEffect, useState } from 'react';
import type { Reminder } from '@home-os/shared';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Field, Input, Select, Textarea } from './ui/Input';
import { Badge } from './ui/Badge';
import { PageHeader } from './ui/PageHeader';
import { EmptyState } from './ui/EmptyState';

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
      const payload = (await res.json()) as { reminders: Reminder[] };
      setRows(payload.reminders);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
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
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-margin md:py-lg">
      <PageHeader
        title="Reminders"
        description="Small nudges for the household and for yourself — appearing as a banner when they fire."
        actions={
          <label className="flex items-center gap-2 text-label-md text-on-surface-variant">
            <input
              type="checkbox"
              checked={includeDismissed}
              onChange={(e) => setIncludeDismissed(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Show dismissed
          </label>
        }
      />

      <Card variant="tonal" padding="md">
        <form onSubmit={(e) => void create(e)} className="flex flex-col gap-4">
          <Field label="Title" required>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Remind me to…"
              required
            />
          </Field>
          <Field label="Details">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Optional notes"
              rows={2}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="When" required>
              <Input
                type="datetime-local"
                value={fireAt}
                onChange={(e) => setFireAt(e.target.value)}
                required
              />
            </Field>
            <Field label="Scope">
              <Select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
                <option value="user">Just me</option>
                <option value="household">Household</option>
              </Select>
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Schedule reminder'}
            </Button>
          </div>
        </form>
      </Card>

      {error && (
        <div className="rounded-md bg-danger-container px-3 py-2 text-label-md text-danger-on-container">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-body-md text-on-surface-variant">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<span aria-hidden>❖</span>}
          title="No reminders scheduled"
          description="Use the form above to set a gentle nudge — a pickup, a prescription refill, a birthday call."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Card variant="outline" padding="none" className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body-md font-medium text-on-surface">{r.title}</span>
                    <Badge tone={r.scope === 'household' ? 'tertiary' : 'neutral'}>{r.scope}</Badge>
                    <Badge tone={statusTone(r.status)} title={r.firedAt ?? undefined}>
                      {r.status}
                    </Badge>
                  </div>
                  <div className="mt-0.5 text-label-md text-on-surface-variant">
                    {formatLocal(r.fireAt)}
                  </div>
                  {r.body && <div className="mt-1 text-body-md text-on-surface">{r.body}</div>}
                </div>
                <div className="flex shrink-0 gap-2">
                  {r.status === 'fired' && (
                    <Button size="sm" variant="tonal" onClick={() => void dismiss(r.id)}>
                      Dismiss
                    </Button>
                  )}
                  <Button size="sm" variant="danger" onClick={() => void del(r.id)}>
                    Delete
                  </Button>
                </div>
              </Card>
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

function statusTone(status: string): 'primary' | 'secondary' | 'neutral' {
  if (status === 'fired') return 'secondary';
  if (status === 'dismissed' || status === 'cancelled') return 'neutral';
  return 'primary';
}
