import { CopilotClient, approveAll, defineTool, type Tool } from '@github/copilot-sdk';
import type { AiContext, AiProvider } from './provider.js';
import {
  CreateTodoArgs,
  CreateEventArgs,
  ImportRecipeArgs,
  ToolCall,
  OPENAI_TOOLS,
} from './tools.js';

// ---------------------------------------------------------------------------
// GitHub Copilot adapter, backed by the official `@github/copilot-sdk`.
//
// Flow: each `parseIntent` call spawns a CopilotClient authenticated with the
// user's stored GitHub OAuth token, creates a short-lived session, exposes our
// three home-os tools (create_todo / create_event / import_recipe) via
// `defineTool`, sends the user prompt, and captures whichever tool(s) the
// model invokes. The handlers never actually execute home-os mutations — they
// just record the call and return a synthetic success. The real execution
// happens later in `/api/ai/execute` after the user approves the preview.
//
// Why spawn-per-request: the SDK is stateful and auth is per-user. With a 2-3
// person household the latency cost (a few seconds of CLI startup) is fine
// and keeps the security boundary clean — one process, one token, torn down.
//
// Dependency note: `@github/copilot-sdk` pulls in `@github/copilot` (the
// Copilot CLI binary, ~130 MB on disk). That's acceptable for a server deploy
// but is called out in plan.md §P10 so arm64 Pi packaging keeps it in mind.
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
  /** Default model. See `listModels()` in the SDK for what's available to you. */
  model?: string;
  /**
   * Optional factory for the underlying `CopilotClient`. Tests inject a fake
   * here; production code passes nothing and we use the real one.
   */
  clientFactory?: (opts: { githubToken: string }) => CopilotClientLike;
}

/** Subset of CopilotClient we actually touch. Kept narrow for test doubles. */
export interface CopilotClientLike {
  start(): Promise<void>;
  stop(): Promise<unknown>;
  createSession(config: {
    model?: string;
    tools: Tool[];
    onPermissionRequest: typeof approveAll;
  }): Promise<CopilotSessionLike>;
}

export interface CopilotSessionLike {
  sendAndWait(
    options: { prompt: string },
    timeout?: number,
  ): Promise<{ data?: { content?: string | null } } | undefined>;
  disconnect(): Promise<void>;
}

const PROMPT_PREFIX =
  `You are a household assistant. Convert the user's request into exactly one tool ` +
  `call using the available functions. Do not ask follow-up questions. Do not ` +
  `invoke any other tools. Times must be ISO-8601 with the user's local offset.\n\n` +
  `User request: `;

const SESSION_TIMEOUT_MS = 60_000;

export class CopilotProvider implements AiProvider {
  readonly name = 'copilot';
  readonly enabled = true;
  private readonly getGithubToken: GithubTokenProvider;
  private readonly model: string;
  private readonly clientFactory: (opts: { githubToken: string }) => CopilotClientLike;

  constructor(opts: CopilotProviderOptions) {
    this.getGithubToken = opts.getGithubToken;
    this.model = opts.model ?? 'gpt-5';
    this.clientFactory =
      opts.clientFactory ??
      ((o) =>
        new CopilotClient({
          githubToken: o.githubToken,
          useLoggedInUser: false,
          logLevel: 'error',
        }) as unknown as CopilotClientLike);
  }

  async parseIntent(prompt: string, ctx: AiContext): Promise<ToolCall[]> {
    const ghToken = await this.getGithubToken(ctx.userId);
    if (!ghToken) throw new CopilotNoTokenError();

    const captured: ToolCall[] = [];
    const tools = buildTools(captured);

    const client = this.clientFactory({ githubToken: ghToken });
    try {
      await client.start();
      const session = await client.createSession({
        model: this.model,
        tools,
        onPermissionRequest: approveAll,
      });
      try {
        const enriched = `${PROMPT_PREFIX}${prompt}\n\nNow make the tool call.`;
        await session.sendAndWait({ prompt: enriched }, SESSION_TIMEOUT_MS);
      } finally {
        await session.disconnect();
      }
    } finally {
      await client.stop();
    }
    return captured;
  }
}

function buildTools(captured: ToolCall[]): Tool[] {
  return [
    defineTool('create_todo', {
      description: OPENAI_TOOLS[0]!.function.description,
      parameters: OPENAI_TOOLS[0]!.function.parameters,
      skipPermission: true,
      handler: (args: unknown) => {
        const parsed = CreateTodoArgs.safeParse(args);
        if (parsed.success) captured.push({ tool: 'create_todo', args: parsed.data });
        return {
          content: 'Proposal recorded. User will confirm before execution.',
          type: 'success' as const,
        };
      },
    }),
    defineTool('create_event', {
      description: OPENAI_TOOLS[1]!.function.description,
      parameters: OPENAI_TOOLS[1]!.function.parameters,
      skipPermission: true,
      handler: (args: unknown) => {
        const parsed = CreateEventArgs.safeParse(args);
        if (parsed.success) captured.push({ tool: 'create_event', args: parsed.data });
        return {
          content: 'Proposal recorded. User will confirm before execution.',
          type: 'success' as const,
        };
      },
    }),
    defineTool('import_recipe', {
      description: OPENAI_TOOLS[2]!.function.description,
      parameters: OPENAI_TOOLS[2]!.function.parameters,
      skipPermission: true,
      handler: (args: unknown) => {
        const parsed = ImportRecipeArgs.safeParse(args);
        if (parsed.success) captured.push({ tool: 'import_recipe', args: parsed.data });
        return {
          content: 'Proposal recorded. User will confirm before execution.',
          type: 'success' as const,
        };
      },
    }),
  ];
}
