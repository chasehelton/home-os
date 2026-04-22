import { useEffect, useMemo, useState } from 'react';

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
      /* non-fatal — GitHub routes are optional UX */
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
      // Open GitHub's verification page in a new tab for the user.
      window.open(start.verificationUri, '_blank', 'noopener,noreferrer');
      // Start polling.
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
  const disabled = useMemo(
    () => status && (!status.enabled || needsGithub),
    [status, needsGithub]
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 text-slate-100">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="text-xl font-semibold">Assistant</h2>
          <p className="text-sm text-slate-400">
            Natural-language commands. Preview before anything changes.
          </p>
        </div>
        <div className="text-xs text-slate-400">
          provider: <span className="text-slate-200">{status?.provider ?? '…'}</span>
        </div>
      </div>

      {isCopilot && (
        <div className="mb-4 rounded border border-slate-700 bg-slate-900 px-3 py-3 text-sm">
          {gh?.connected ? (
            <div className="flex items-center justify-between gap-3">
              <div className="text-slate-200">
                Connected to GitHub as{' '}
                <span className="font-medium">{gh.account?.githubLogin ?? '…'}</span>
                <span className="ml-2 text-xs text-slate-400">
                  (via GitHub Copilot — your GitHub token authorizes Copilot access)
                </span>
              </div>
              <button
                onClick={() => void onDisconnectGithub()}
                className="rounded border border-slate-600 px-3 py-1 text-xs hover:bg-slate-800"
              >
                Disconnect
              </button>
            </div>
          ) : device ? (
            <div className="space-y-2">
              <p className="text-slate-200">
                Visit{' '}
                <a
                  href={device.verificationUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 underline"
                >
                  {device.verificationUri}
                </a>{' '}
                and enter this code:
              </p>
              <div className="font-mono text-2xl tracking-widest text-amber-300">
                {device.userCode}
              </div>
              <p className="text-xs text-slate-400">
                Waiting for you to authorize… This page will update automatically.
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="text-slate-200">
                Connect your GitHub account to enable the assistant. The assistant uses
                GitHub Copilot via the official SDK — no separate API key needed.
              </div>
              <button
                onClick={() => void onConnectGithub()}
                disabled={connecting}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
              >
                {connecting ? 'Starting…' : 'Connect GitHub'}
              </button>
            </div>
          )}
          {ghError && (
            <div className="mt-2 rounded bg-red-950 px-2 py-1 text-xs text-red-300">
              {ghError}
            </div>
          )}
        </div>
      )}

      {status && !status.enabled && !isCopilot && (
        <div className="mb-4 rounded border border-amber-700 bg-amber-950 px-3 py-2 text-sm text-amber-200">
          AI is disabled on this server. Set <code>HOME_OS_AI_PROVIDER</code> (and a key for
          OpenAI) to enable it.
        </div>
      )}

      <div className="mb-4 flex flex-col gap-2">
        <textarea
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
          className="w-full resize-y rounded border border-slate-700 bg-slate-900 p-2 text-sm focus:border-blue-500 focus:outline-none disabled:opacity-60"
        />
        <div className="flex gap-2">
          <button
            onClick={() => void onParse()}
            disabled={!!disabled || !prompt.trim() || parsing}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {parsing ? 'Planning…' : 'Plan actions'}
          </button>
          {(proposals || outcomes) && (
            <button
              onClick={onReset}
              className="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      {proposals && proposals.length > 0 && !outcomes && (
        <div className="mb-4 flex flex-col gap-3">
          <h3 className="text-sm font-medium text-slate-300">
            Proposed actions ({proposals.length})
          </h3>
          {proposals.map((call, i) => (
            <ProposalCard
              key={i}
              call={call}
              onChange={(next) => updateProposal(i, () => next)}
            />
          ))}
          <div>
            <button
              onClick={() => void onExecute()}
              disabled={executing}
              className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
            >
              {executing ? 'Running…' : 'Confirm and run'}
            </button>
          </div>
        </div>
      )}

      {outcomes && (
        <div className="mb-4 flex flex-col gap-2">
          <h3 className="text-sm font-medium text-slate-300">Results</h3>
          {outcomes.map((o, i) => (
            <div
              key={i}
              className={`rounded border px-3 py-2 text-sm ${
                o.ok
                  ? 'border-emerald-700 bg-emerald-950 text-emerald-100'
                  : 'border-red-800 bg-red-950 text-red-100'
              }`}
            >
              {o.ok
                ? `✓ ${o.entityType} created (${o.entityId})`
                : `✗ ${o.error ?? 'failed'}`}
            </div>
          ))}
        </div>
      )}

      <div className="mt-auto">
        <h3 className="mb-2 text-sm font-medium text-slate-300">Recent</h3>
        {transcripts.length === 0 ? (
          <p className="text-xs text-slate-500">No interactions yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-xs text-slate-400">
            {transcripts.map((t) => (
              <li key={t.id} className="truncate">
                <span className="text-slate-500">
                  {new Date(t.createdAt).toLocaleTimeString()} ·{' '}
                </span>
                <span className="text-slate-200">{t.prompt}</span>
                <span className="text-slate-500">
                  {' '}
                  → {t.toolCalls.map((c) => c.tool).join(', ') || '(no calls)'}
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

function ProposalCard({
  call,
  onChange,
}: {
  call: ToolCall;
  onChange: (next: ToolCall) => void;
}) {
  return (
    <div className="rounded border border-slate-700 bg-slate-900 p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-blue-300">
        {call.tool.replace(/_/g, ' ')}
      </div>
      {call.tool === 'create_todo' && (
        <TodoFields
          args={call.args}
          onChange={(args) => onChange({ tool: 'create_todo', args })}
        />
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
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-2 block text-xs">
      <span className="mb-0.5 block text-slate-400">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none';

function TodoFields({
  args,
  onChange,
}: {
  args: CreateTodoArgs;
  onChange: (next: CreateTodoArgs) => void;
}) {
  return (
    <>
      <Field label="Title">
        <input
          className={inputCls}
          value={args.title}
          onChange={(e) => onChange({ ...args, title: e.target.value })}
        />
      </Field>
      <Field label="Scope">
        <select
          className={inputCls}
          value={args.scope}
          onChange={(e) =>
            onChange({ ...args, scope: e.target.value as 'household' | 'user' })
          }
        >
          <option value="household">household</option>
          <option value="user">user</option>
        </select>
      </Field>
      <Field label="Due (ISO, optional)">
        <input
          className={inputCls}
          value={args.dueAt ?? ''}
          onChange={(e) =>
            onChange({ ...args, dueAt: e.target.value || null })
          }
          placeholder="2026-05-01T18:00:00-04:00"
        />
      </Field>
    </>
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
    <>
      <Field label="Title">
        <input
          className={inputCls}
          value={args.title}
          onChange={(e) => onChange({ ...args, title: e.target.value })}
        />
      </Field>
      <Field label="Start (ISO)">
        <input
          className={inputCls}
          value={args.startAt}
          onChange={(e) => onChange({ ...args, startAt: e.target.value })}
        />
      </Field>
      <Field label="End (ISO)">
        <input
          className={inputCls}
          value={args.endAt}
          onChange={(e) => onChange({ ...args, endAt: e.target.value })}
        />
      </Field>
      <Field label="Location (optional)">
        <input
          className={inputCls}
          value={args.location ?? ''}
          onChange={(e) =>
            onChange({ ...args, location: e.target.value || null })
          }
        />
      </Field>
    </>
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
    <Field label="URL">
      <input
        className={inputCls}
        value={args.url}
        onChange={(e) => onChange({ ...args, url: e.target.value })}
      />
    </Field>
  );
}
