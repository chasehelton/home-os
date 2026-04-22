import type { AiContext, AiProvider } from './provider.js';
import { ToolCall, OPENAI_TOOLS } from './tools.js';

// ---------------------------------------------------------------------------
// GitHub Copilot adapter.
//
// Uses the GitHub Copilot chat-completions endpoint, which is OpenAI-compatible
// (same tool-call contract as OpenAIProvider). Authentication is a two-step
// exchange:
//   1. `ghTokenProvider(userId)` returns the user's long-lived GitHub OAuth
//      access token (stored encrypted in `github_accounts`).
//   2. We POST that token to `api.github.com/copilot_internal/v2/token` to
//      get a short-lived Copilot session token (expires in ~30 min). The
//      session token is what authorizes chat-completions calls.
//
// The Copilot token endpoint is technically undocumented but has been the
// stable auth path used by the VS Code Copilot extension for years. If the
// user has no GitHub connection, we throw `CopilotNoTokenError` so the route
// can return a structured error asking the user to connect.
// ---------------------------------------------------------------------------

export class CopilotNoTokenError extends Error {
  readonly code = 'github_not_connected';
  constructor() {
    super('No GitHub account connected for this user. Connect via the Assistant tab.');
    this.name = 'CopilotNoTokenError';
  }
}

export type GithubTokenProvider = (userId: string) => Promise<string | null> | string | null;

export interface CopilotProviderOptions {
  getGithubToken: GithubTokenProvider;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Override 'now' for deterministic tests of session-token caching. */
  nowFn?: () => number;
}

interface CopilotSessionToken {
  token: string;
  expiresAtMs: number;
}

interface ChatToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}
interface ChatChoice {
  message?: { content?: string | null; tool_calls?: ChatToolCall[] };
}
interface ChatResponse {
  choices?: ChatChoice[];
}

const SYSTEM_PROMPT =
  `You are a household assistant for a 2-user home-os app. Convert the user ` +
  `request into tool calls using the provided functions. Prefer a single tool ` +
  `call. Times MUST be absolute ISO-8601 with the user's local offset. If the ` +
  `request is ambiguous, do not call a tool.`;

export class CopilotProvider implements AiProvider {
  readonly name = 'copilot';
  readonly enabled = true;
  private readonly getGithubToken: GithubTokenProvider;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly nowFn: () => number;
  // Per-user Copilot session-token cache. Keyed by the underlying GitHub
  // access token so rotating the GH token invalidates the cache automatically.
  private readonly sessionCache = new Map<string, CopilotSessionToken>();

  constructor(opts: CopilotProviderOptions) {
    this.getGithubToken = opts.getGithubToken;
    this.model = opts.model ?? 'gpt-4o-mini';
    this.baseUrl = (opts.baseUrl ?? 'https://api.githubcopilot.com').replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.nowFn = opts.nowFn ?? Date.now;
  }

  async parseIntent(prompt: string, ctx: AiContext): Promise<ToolCall[]> {
    const ghToken = await this.getGithubToken(ctx.userId);
    if (!ghToken) throw new CopilotNoTokenError();
    const copilotToken = await this.getSessionToken(ghToken);

    const body = {
      model: this.model,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'system',
          content: `Current time: ${ctx.now.toISOString()}. User id: ${ctx.userId}.`,
        },
        { role: 'user', content: prompt },
      ],
      tools: OPENAI_TOOLS,
      tool_choice: 'auto',
    };

    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: copilotChatHeaders(copilotToken),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // If the session token was just rejected, clear the cache so next call
      // re-exchanges — handles the race where a cached token expires mid-flight.
      if (res.status === 401) this.sessionCache.delete(ghToken);
      const text = await res.text().catch(() => '');
      throw new Error(`copilot_http_${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as ChatResponse;
    const calls = data.choices?.[0]?.message?.tool_calls ?? [];
    const out: ToolCall[] = [];
    for (const c of calls) {
      const name = c.function?.name;
      const rawArgs = c.function?.arguments;
      if (!name || typeof rawArgs !== 'string') continue;
      let parsedArgs: unknown;
      try {
        parsedArgs = JSON.parse(rawArgs);
      } catch {
        continue;
      }
      const candidate = { tool: name, args: parsedArgs };
      const parsed = ToolCall.safeParse(candidate);
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  }

  private async getSessionToken(ghToken: string): Promise<string> {
    const cached = this.sessionCache.get(ghToken);
    // Refresh 60s before actual expiry to avoid mid-request invalidation.
    if (cached && cached.expiresAtMs - this.nowFn() > 60_000) {
      return cached.token;
    }
    const res = await this.fetchImpl('https://api.github.com/copilot_internal/v2/token', {
      method: 'GET',
      headers: {
        authorization: `token ${ghToken}`,
        accept: 'application/json',
        'user-agent': 'home-os/1.0',
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`copilot_session_http_${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as { token?: string; expires_at?: number };
    if (!data.token) throw new Error('copilot_session_missing_token');
    const expiresAtMs =
      typeof data.expires_at === 'number' ? data.expires_at * 1000 : this.nowFn() + 25 * 60_000;
    this.sessionCache.set(ghToken, { token: data.token, expiresAtMs });
    return data.token;
  }
}

export function copilotChatHeaders(copilotToken: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${copilotToken}`,
    'editor-version': 'home-os/1.0',
    'editor-plugin-version': 'home-os-ai/0.1',
    'copilot-integration-id': 'vscode-chat',
    'openai-intent': 'conversation-panel',
    'user-agent': 'home-os/1.0',
  };
}
