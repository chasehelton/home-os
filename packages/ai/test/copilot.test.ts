import { describe, expect, it, vi } from 'vitest';
import { CopilotProvider, CopilotNoTokenError, type CopilotClientLike } from '../src/copilot.js';
import type { Tool, ToolHandler } from '@github/copilot-sdk';

const NOW = new Date('2026-04-22T12:00:00Z');
const ctx = { userId: 'u1', now: NOW };

// Factory that builds a fake CopilotClient/Session whose `sendAndWait` runs
// the caller-supplied `simulate(tools)` hook. The hook receives the three
// defineTool entries so the test can invoke whichever handler(s) it wants —
// that's how we simulate "the model decided to call this tool".
function makeFakeFactory(simulate: (tools: Tool[]) => void | Promise<void>) {
  const session = {
    sendAndWait: vi.fn(async (_opts: { prompt: string }) => {
      await simulate(capturedTools);
      return { data: { content: 'ok' } };
    }),
    disconnect: vi.fn(async () => undefined),
  };
  let capturedTools: Tool[] = [];
  const client: CopilotClientLike = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => []),
    createSession: vi.fn(async (config: { tools: Tool[] }) => {
      capturedTools = config.tools;
      return session;
    }),
  };
  const factory = vi.fn(() => client);
  return { factory, client, session };
}

function invokeHandler(tools: Tool[], name: string, args: unknown): unknown {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`test tool ${name} not registered`);
  return (t.handler as ToolHandler)(args, {} as never);
}

describe('CopilotProvider (via @github/copilot-sdk)', () => {
  it('throws CopilotNoTokenError when user has no GitHub token', async () => {
    const { factory } = makeFakeFactory(() => undefined);
    const p = new CopilotProvider({ getGithubToken: () => null, clientFactory: factory });
    await expect(p.parseIntent('hi', ctx)).rejects.toBeInstanceOf(CopilotNoTokenError);
    expect(factory).not.toHaveBeenCalled();
  });

  it('captures a tool call from the Copilot session', async () => {
    const { factory, client, session } = makeFakeFactory(async (tools) => {
      await invokeHandler(tools, 'create_todo', { title: 'milk', scope: 'household' });
    });
    const p = new CopilotProvider({
      getGithubToken: () => 'gho_abc',
      clientFactory: factory,
    });
    const out = await p.parseIntent('add milk', ctx);

    expect(out).toEqual([{ tool: 'create_todo', args: { title: 'milk', scope: 'household' } }]);
    expect(factory).toHaveBeenCalledWith({ githubToken: 'gho_abc' });
    expect(client.start).toHaveBeenCalledOnce();
    expect(session.disconnect).toHaveBeenCalledOnce();
    expect(client.stop).toHaveBeenCalledOnce();
  });

  it('captures multiple tool calls in order', async () => {
    const { factory } = makeFakeFactory(async (tools) => {
      await invokeHandler(tools, 'create_todo', { title: 'bread', scope: 'household' });
      await invokeHandler(tools, 'import_recipe', { url: 'https://example.com/x' });
    });
    const p = new CopilotProvider({ getGithubToken: () => 'gho_abc', clientFactory: factory });
    const out = await p.parseIntent('two things', ctx);
    expect(out.map((c) => c.tool)).toEqual(['create_todo', 'import_recipe']);
  });

  it('drops tool invocations that fail schema validation', async () => {
    const { factory } = makeFakeFactory(async (tools) => {
      await invokeHandler(tools, 'create_todo', { scope: 'nope' });
    });
    const p = new CopilotProvider({ getGithubToken: () => 'gho_abc', clientFactory: factory });
    expect(await p.parseIntent('x', ctx)).toEqual([]);
  });

  it('cleans up session and client even when the session throws', async () => {
    const { factory, client, session } = makeFakeFactory(async () => {
      throw new Error('boom');
    });
    const p = new CopilotProvider({ getGithubToken: () => 'gho_abc', clientFactory: factory });
    await expect(p.parseIntent('x', ctx)).rejects.toThrow(/boom/);
    expect(session.disconnect).toHaveBeenCalledOnce();
    expect(client.stop).toHaveBeenCalledOnce();
  });

  it('registers create_todo, create_event, and import_recipe tools', async () => {
    let seen: string[] = [];
    const { factory } = makeFakeFactory((tools) => {
      seen = tools.map((t) => t.name);
    });
    const p = new CopilotProvider({ getGithubToken: () => 'gho_abc', clientFactory: factory });
    await p.parseIntent('noop', ctx);
    expect(seen.sort()).toEqual(['create_event', 'create_todo', 'import_recipe']);
  });

  it('passes the configured model to createSession', async () => {
    const { factory, client } = makeFakeFactory(() => undefined);
    const p = new CopilotProvider({
      getGithubToken: () => 'gho_abc',
      model: 'claude-sonnet-4.5',
      clientFactory: factory,
    });
    await p.parseIntent('noop', ctx);
    const call = (client.createSession as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      model: string;
    };
    expect(call.model).toBe('claude-sonnet-4.5');
  });
});
