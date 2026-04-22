import type { AiContext, AiProvider } from './provider.js';
import { ToolCall, OPENAI_TOOLS } from './tools.js';

// ---------------------------------------------------------------------------
// GitHub Models adapter ("copilot" provider).
//
// Uses the officially-public GitHub Models inference API:
//   POST https://models.github.ai/inference/chat/completions
//   Authorization: Bearer <GitHub user token>
//
// The endpoint is OpenAI-compatible (same tool-call contract as OpenAIProvider)
// and is documented at https://docs.github.com/en/rest/models. Authentication
// is a single-step: we send the user's long-lived GitHub OAuth access token
// directly — no session-token exchange, no undocumented endpoints.
//
// Models are addressed as `publisher/name` (e.g. `openai/gpt-4o-mini`). The
// default is chosen for low-cost tool-call use; operators can override via
// HOME_OS_COPILOT_MODEL to pick any model available on GitHub Models
// (openai/*, meta/*, mistral-ai/*, microsoft/*, etc.).
//
// We still call the provider "copilot" because that's how users think about
// it ("my GitHub Copilot subscription") — but the wire protocol is the public
// Models API, not the internal Copilot Chat endpoint.
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

  constructor(opts: CopilotProviderOptions) {
    this.getGithubToken = opts.getGithubToken;
    this.model = opts.model ?? 'openai/gpt-4o-mini';
    this.baseUrl = (opts.baseUrl ?? 'https://models.github.ai').replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async parseIntent(prompt: string, ctx: AiContext): Promise<ToolCall[]> {
    const ghToken = await this.getGithubToken(ctx.userId);
    if (!ghToken) throw new CopilotNoTokenError();

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

    const res = await this.fetchImpl(`${this.baseUrl}/inference/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ghToken}`,
        accept: 'application/json',
        'user-agent': 'home-os/1.0',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
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
}
