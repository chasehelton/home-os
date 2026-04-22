import { useEffect, useState } from 'react';
import { disablePush, enablePush, getExistingSubscription, pushSupported } from '../lib/push';
import { useTheme, type ThemeMode } from '../lib/theme';
import { Button, ButtonLink } from './ui/Button';
import { Card, CardHeader } from './ui/Card';
import { Badge } from './ui/Badge';
import { PageHeader } from './ui/PageHeader';
import { SegmentedTabs } from './ui/Tabs';

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
  const { mode, setMode } = useTheme();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  async function refreshPush() {
    if (!pushSupported()) return;
    const sub = await getExistingSubscription();
    setPushEnabled(!!sub);
  }

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
    void refreshPush();
  }, []);

  async function togglePush() {
    setPushBusy(true);
    setPushError(null);
    try {
      if (pushEnabled) {
        await disablePush();
      } else {
        await enablePush();
      }
      await refreshPush();
    } catch (e) {
      setPushError(e instanceof Error ? e.message : 'push failed');
    } finally {
      setPushBusy(false);
    }
  }

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
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-margin md:py-lg">
      <PageHeader title="Settings" description="Tune home-os to fit the household." />

      <Card variant="outline" padding="md">
        <CardHeader
          title="Appearance"
          description="Match the light of the room, or follow whatever the device is set to."
        />
        <SegmentedTabs<ThemeMode>
          value={mode}
          onChange={setMode}
          tabs={[
            { id: 'system', label: 'System' },
            { id: 'light', label: 'Light' },
            { id: 'dark', label: 'Dark' },
          ]}
        />
      </Card>

      <Card variant="outline" padding="md">
        <CardHeader
          title="Google Calendar"
          description="Read-only sync of your Google calendars. Events refresh automatically every few minutes."
        />
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/auth/google/calendar/connect" variant="primary">
            Connect Google Calendar
          </ButtonLink>
          <Button
            variant="tonal"
            onClick={() => void syncNow()}
            disabled={busy !== null || accounts.length === 0}
          >
            {busy === 'sync' ? 'Syncing…' : 'Sync now'}
          </Button>
        </div>
      </Card>

      <Card variant="outline" padding="md">
        <CardHeader
          title="Notifications"
          description="Fired reminders always appear in the banner and on the kiosk. Turn on push to also get system notifications on this device. iOS requires the PWA to be installed to the Home Screen first."
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => void togglePush()}
            disabled={pushBusy || !pushSupported()}
            variant="primary"
          >
            {pushBusy
              ? pushEnabled
                ? 'Disabling…'
                : 'Enabling…'
              : pushEnabled
                ? 'Disable push on this device'
                : 'Enable push on this device'}
          </Button>
          {!pushSupported() && (
            <span className="text-label-md text-on-surface-variant">
              Push not supported in this browser.
            </span>
          )}
        </div>
        {pushError && (
          <div className="mt-3 rounded-md bg-danger-container px-3 py-2 text-label-md text-danger-on-container">
            {pushError}
          </div>
        )}
      </Card>

      {error && (
        <div className="rounded-md bg-danger-container px-3 py-2 text-label-md text-danger-on-container">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-body-md text-on-surface-variant">Loading…</div>
      ) : accounts.length === 0 ? (
        <div className="text-body-md text-on-surface-variant">
          No calendar accounts connected yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {accounts.map((a) => (
            <li key={a.id}>
              <Card variant="outline" padding="md" className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-body-md font-medium text-on-surface">
                      {a.email}
                    </div>
                    <div className="mt-0.5 text-label-md text-on-surface-variant">
                      Status: {a.status}
                      {a.lastError ? ` · last error: ${a.lastError}` : ''}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void disconnect(a.id)}
                    disabled={busy !== null}
                  >
                    {busy === a.id ? 'Removing…' : 'Disconnect'}
                  </Button>
                </div>
                {a.calendars.length > 0 && (
                  <ul className="flex flex-col gap-1.5 text-body-md text-on-surface">
                    {a.calendars.map((c) => (
                      <li key={c.id} className="flex items-center gap-2">
                        <span className="text-on-surface-variant" aria-hidden>
                          •
                        </span>
                        <span className="truncate">{c.summary}</span>
                        {c.primary && <Badge tone="primary">primary</Badge>}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
