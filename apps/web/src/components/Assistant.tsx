import { useEffect, useMemo, useState } from 'react';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Field as UiField, Input, Select, Textarea } from './ui/Input';
import { Badge } from './ui/Badge';
import { PageHeader } from './ui/PageHeader';

// ---------------------------------------------------------------------------
// Phase 9 — AI assistant tab.
//
// Flow: type prompt → "Plan actions" (/api/ai/parse, no side effects) →
// review preview cards (editable title/args) → "Confirm and run"
// (/api/ai/execute) → outcomes shown inline. Recent transcripts below.
// ---------------------------------------------------------------------------

type ToolCall =
  | { tool: 'create_todo'; args: CreateTodoArgs }
  | { tool: 'create_event'; args: CreateEventArgs }
  | { tool: 'import_recipe'; args: ImportRecipeArgs };

interface CreateTodoArgs {
  title: string;
  scope: 'household' | 'user';
  dueAt?: string | null;
  notes?: string | null;
}
interface CreateEventArgs {
  title: string;
  startAt: string;
  endAt: string;
  location?: string | null;
  description?: string | null;
}
interface ImportRecipeArgs {
  url: string;
}

interface Outcome {
  ok: boolean;
  entityId?: string;
  entityType?: 'todo' | 'calendar_event' | 'recipe';
  error?: string;
}

interface Transcript {
  id: string;
  provider: string;
  prompt: string;
  toolCalls: ToolCall[];
  outcomes: Outcome[] | null;
  createdAt: string;
}

interface Status {
  provider: string;
  enabled: boolean;
  needsGithub?: boolean;
}

interface GithubStatus {
  connected: boolean;
  clientId: string;
  account: {
    githubLogin: string;
    githubUserId: number;
    scopes: string;
    status: string;
    createdAt: string;
  } | null;
  pendingAuthorization: boolean;
}

interface DeviceStart {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

interface PollResponse {
  status: 'ok' | 'pending' | 'error';
  reason?: string;
  error?: string;
  description?: string | null;
  interval?: number;
  account?: { githubLogin: string; githubUserId: number; scopes: string };
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? `http_${res.status}`);
  }
  return body as T;
}

export function Assistant() {
  const [status, setStatus] = useState<Status | null>(null);
  const [prompt, setPrompt] = useState('');
  const [activePrompt, setActivePrompt] = useState('');
  const [proposals, setProposals] = useState<ToolCall[] | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [gh, setGh] = useState<GithubStatus | null>(null);
  const [device, setDevice] = useState<DeviceStart | null>(null);
  const [ghError, setGhError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  async function loadStatus() {
    try {
      setStatus(await jsonFetch<Status>('/api/ai/status'));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function loadGithubStatus() {
    try {
      setGh(await jsonFetch<GithubStatus>('/api/github/status'));
    } catch {
      /* non-fatal */
    }
  }

  async function loadTranscripts() {
    try {
      const res = await jsonFetch<{ transcripts: Transcript[] }>('/api/ai/transcripts');
      setTranscripts(res.transcripts);
    } catch {
      /* non-fatal */
    }
  }

  useEffect(() => {
    void loadStatus();
    void loadTranscripts();
    void loadGithubStatus();
  }, []);

  async function onConnectGithub() {
    setGhError(null);
    setConnecting(true);
    try {
      const start = await jsonFetch<DeviceStart>('/api/github/device/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      setDevice(start);
      window.open(start.verificationUri, '_blank', 'noopener,noreferrer');
      await pollUntilDone(start.interval);
    } catch (e) {
      setGhError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  }

  async function pollUntilDone(startInterval: number) {
    let interval = Math.max(1, startInterval);
    const deadline = Date.now() + 15 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval * 1000));
      let resp: PollResponse;
      try {
        resp = await jsonFetch<PollResponse>('/api/github/device/poll', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
      } catch (e) {
        setGhError((e as Error).message);
        return;
      }
      if (resp.status === 'ok') {
        setDevice(null);
        await loadGithubStatus();
        await loadStatus();
        return;
      }
      if (resp.status === 'error') {
        setDevice(null);
        setGhError(resp.error ?? 'authorization_failed');
        return;
      }
      if (resp.interval && resp.interval > interval) interval = resp.interval;
    }
    setDevice(null);
    setGhError('Authorization timed out.');
  }

  async function onDisconnectGithub() {
    if (!confirm('Disconnect GitHub? This disables the AI assistant until you reconnect.')) return;
    try {
      await jsonFetch<{ ok: true }>('/api/github/account', { method: 'DELETE' });
      setDevice(null);
      setGhError(null);
      await loadGithubStatus();
      await loadStatus();
    } catch (e) {
      setGhError((e as Error).message);
    }
  }

  async function onParse() {
    if (!prompt.trim()) return;
    setError(null);
    setOutcomes(null);
    setProposals(null);
    setParsing(true);
    try {
      const res = await jsonFetch<{ toolCalls: ToolCall[] }>('/api/ai/parse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      setProposals(res.toolCalls);
      setActivePrompt(prompt);
      if (res.toolCalls.length === 0) {
        setError('I could not match this to a tool. Try rephrasing.');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setParsing(false);
    }
  }

  async function onExecute() {
    if (!proposals || proposals.length === 0) return;
    setExecuting(true);
    setError(null);
    try {
      const res = await jsonFetch<{ outcomes: Outcome[] }>('/api/ai/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: activePrompt, toolCalls: proposals }),
      });
      setOutcomes(res.outcomes);
      await loadTranscripts();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExecuting(false);
    }
  }

  function onReset() {
    setProposals(null);
    setOutcomes(null);
    setActivePrompt('');
    setPrompt('');
    setError(null);
  }

  function updateProposal(index: number, updater: (call: ToolCall) => ToolCall) {
    setProposals((prev) => {
      if (!prev) return prev;
      const current = prev[index];
      if (!current) return prev;
      const next = prev.slice();
      next[index] = updater(current);
      return next;
    });
  }

  const isCopilot = status?.provider === 'copilot';
  const needsGithub = !!(isCopilot && status?.needsGithub);
  const disabled = useMemo(() => status && (!status.enabled || needsGithub), [status, needsGithub]);

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-margin md:py-lg">
      <PageHeader
        title="Assistant"
        description="Plain-English commands. Nothing happens until you confirm."
        actions={
          <Badge tone="neutral">
            provider: <span className="ml-1 normal-case">{status?.provider ?? '…'}</span>
          </Badge>
        }
      />

      {isCopilot && (
        <Card variant="outline" padding="md">
          {gh?.connected ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-body-md text-on-surface">
                Connected to GitHub as{' '}
                <span className="font-medium">{gh.account?.githubLogin ?? '…'}</span>
                <span className="ml-2 text-label-md text-on-surface-variant">
                  (via GitHub Copilot — your GitHub token authorizes Copilot access)
                </span>
              </div>
              <Button size="sm" variant="outline" onClick={() => void onDisconnectGithub()}>
                Disconnect
              </Button>
            </div>
          ) : device ? (
            <div className="space-y-3">
              <p className="text-body-md text-on-surface">
                Visit{' '}
                <a
                  href={device.verificationUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  {device.verificationUri}
                </a>{' '}
                and enter this code:
              </p>
              <div className="font-mono text-[2rem] tracking-widest text-secondary-on-container">
                <span className="rounded-md bg-secondary-container px-3 py-1">
                  {device.userCode}
                </span>
              </div>
              <p className="text-label-md text-on-surface-variant">
                Waiting for you to authorize… This page will update automatically.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-body-md text-on-surface">
                Connect your GitHub account to enable the assistant. The assistant uses GitHub
                Copilot via the official SDK — no separate API key needed.
              </div>
              <Button onClick={() => void onConnectGithub()} disabled={connecting}>
                {connecting ? 'Starting…' : 'Connect GitHub'}
              </Button>
            </div>
          )}
          {ghError && (
            <div className="mt-3 rounded-md bg-danger-container px-3 py-2 text-label-md text-danger-on-container">
              {ghError}
            </div>
          )}
        </Card>
      )}

      {status && !status.enabled && !isCopilot && (
        <div className="rounded-md bg-secondary-container px-3 py-2 text-body-md text-secondary-on-container">
          AI is disabled on this server. Set <code className="font-mono">HOME_OS_AI_PROVIDER</code>{' '}
          (and a key for OpenAI) to enable it.
        </div>
      )}

      <Card variant="tonal" padding="sm" className="sm:p-4">
        <div className="flex flex-col gap-3">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder={
              needsGithub
                ? 'Connect GitHub above to enable the assistant.'
                : disabled
                  ? 'AI is currently disabled.'
                  : 'e.g. "add milk to the shared todo list" or "import recipe https://example.com/cookie"'
            }
            disabled={!!disabled}
          />
          <div className="flex gap-2">
            <Button
              onClick={() => void onParse()}
              disabled={!!disabled || !prompt.trim() || parsing}
            >
              {parsing ? 'Planning…' : 'Plan actions'}
            </Button>
            {(proposals || outcomes) && (
              <Button variant="tonal" onClick={onReset}>
                Reset
              </Button>
            )}
          </div>
        </div>
      </Card>

      {error && (
        <div className="rounded-md bg-danger-container px-3 py-2 text-label-md text-danger-on-container">
          {error}
        </div>
      )}

      {proposals && proposals.length > 0 && !outcomes && (
        <div className="flex flex-col gap-3">
          <h3 className="font-display text-headline-md text-on-surface">
            Proposed actions ({proposals.length})
          </h3>
          {proposals.map((call, i) => (
            <ProposalCard key={i} call={call} onChange={(next) => updateProposal(i, () => next)} />
          ))}
          <div>
            <Button variant="primary" onClick={() => void onExecute()} disabled={executing}>
              {executing ? 'Running…' : 'Confirm and run'}
            </Button>
          </div>
        </div>
      )}

      {outcomes && (
        <div className="flex flex-col gap-2">
          <h3 className="font-display text-headline-md text-on-surface">Results</h3>
          {outcomes.map((o, i) => (
            <div
              key={i}
              className={
                o.ok
                  ? 'rounded-md bg-tertiary-container px-3 py-2 text-body-md text-tertiary-on-container'
                  : 'rounded-md bg-danger-container px-3 py-2 text-body-md text-danger-on-container'
              }
            >
              {o.ok ? `✓ ${o.entityType} created (${o.entityId})` : `✗ ${o.error ?? 'failed'}`}
            </div>
          ))}
        </div>
      )}

      <div className="mt-auto">
        <h3 className="mb-3 font-display text-headline-md text-on-surface">Recent</h3>
        {transcripts.length === 0 ? (
          <p className="text-label-md text-on-surface-variant">No interactions yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-outline-variant/60 rounded-lg bg-surface-container-low">
            {transcripts.map((t) => (
              <li key={t.id} className="px-4 py-3 text-label-md text-on-surface-variant">
                <span className="text-on-surface-variant/80">
                  {new Date(t.createdAt).toLocaleTimeString()} ·{' '}
                </span>
                <span className="text-on-surface">{t.prompt}</span>
                <span>
                  {' → '}
                  {t.toolCalls.map((c) => c.tool).join(', ') || '(no calls)'}
                  {t.outcomes
                    ? ` · ${t.outcomes.filter((o) => o.ok).length}/${t.outcomes.length} ok`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ProposalCard({ call, onChange }: { call: ToolCall; onChange: (next: ToolCall) => void }) {
  return (
    <Card variant="elevated" padding="md">
      <Badge tone="primary" className="mb-3">
        {call.tool.replace(/_/g, ' ')}
      </Badge>
      {call.tool === 'create_todo' && (
        <TodoFields args={call.args} onChange={(args) => onChange({ tool: 'create_todo', args })} />
      )}
      {call.tool === 'create_event' && (
        <EventFields
          args={call.args}
          onChange={(args) => onChange({ tool: 'create_event', args })}
        />
      )}
      {call.tool === 'import_recipe' && (
        <RecipeFields
          args={call.args}
          onChange={(args) => onChange({ tool: 'import_recipe', args })}
        />
      )}
    </Card>
  );
}

function TodoFields({
  args,
  onChange,
}: {
  args: CreateTodoArgs;
  onChange: (next: CreateTodoArgs) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <UiField label="Title">
        <Input value={args.title} onChange={(e) => onChange({ ...args, title: e.target.value })} />
      </UiField>
      <UiField label="Scope">
        <Select
          value={args.scope}
          onChange={(e) => onChange({ ...args, scope: e.target.value as 'household' | 'user' })}
        >
          <option value="household">household</option>
          <option value="user">user</option>
        </Select>
      </UiField>
      <UiField label="Due (ISO, optional)">
        <Input
          value={args.dueAt ?? ''}
          onChange={(e) => onChange({ ...args, dueAt: e.target.value || null })}
          placeholder="2026-05-01T18:00:00-04:00"
        />
      </UiField>
    </div>
  );
}

function EventFields({
  args,
  onChange,
}: {
  args: CreateEventArgs;
  onChange: (next: CreateEventArgs) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <UiField label="Title">
        <Input value={args.title} onChange={(e) => onChange({ ...args, title: e.target.value })} />
      </UiField>
      <UiField label="Start (ISO)">
        <Input value={args.startAt} onChange={(e) => onChange({ ...args, startAt: e.target.value })} />
      </UiField>
      <UiField label="End (ISO)">
        <Input value={args.endAt} onChange={(e) => onChange({ ...args, endAt: e.target.value })} />
      </UiField>
      <UiField label="Location (optional)">
        <Input
          value={args.location ?? ''}
          onChange={(e) => onChange({ ...args, location: e.target.value || null })}
        />
      </UiField>
    </div>
  );
}

function RecipeFields({
  args,
  onChange,
}: {
  args: ImportRecipeArgs;
  onChange: (next: ImportRecipeArgs) => void;
}) {
  return (
    <UiField label="URL">
      <Input value={args.url} onChange={(e) => onChange({ ...args, url: e.target.value })} />
    </UiField>
  );
}
