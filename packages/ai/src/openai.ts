import type { AiContext, AiProvider } from './provider.js';
import { ToolCall, OPENAI_TOOLS } from './tools.js';

// ---------------------------------------------------------------------------
// Minimal OpenAI Chat Completions adapter using native fetch (no SDK dep).
// - `fetchImpl` is injectable for tests.
// - Honors OPENAI_BASE_URL to allow Azure / self-hosted / recorded fixtures.
// - Parses every returned tool_call through the zod union; invalid calls are
//   silently dropped (the preview screen is the user safety net either way).
// ---------------------------------------------------------------------------

export interface OpenAIProviderOptions {
  apiKey: string;
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

export class OpenAIProvider implements AiProvider {
  readonly name = 'openai';
  readonly enabled = true;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpenAIProviderOptions) {
    if (!opts.apiKey) throw new Error('OpenAIProvider requires apiKey');
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? 'gpt-4o-mini';
    this.baseUrl = (opts.baseUrl ?? 'https://api.openai.com').replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async parseIntent(prompt: string, ctx: AiContext): Promise<ToolCall[]> {
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

    const res = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`openai_http_${res.status}: ${text.slice(0, 200)}`);
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
