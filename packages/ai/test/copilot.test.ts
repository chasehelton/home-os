import { describe, expect, it, vi } from 'vitest';
import { CopilotProvider, CopilotNoTokenError } from '../src/copilot.js';

const NOW = new Date('2026-04-22T12:00:00Z');
const ctx = { userId: 'u1', now: NOW };

// Returns a fetch double that routes by URL to either the session-token
// endpoint or the chat-completions endpoint. Lets us assert both phases
// of the Copilot auth exchange without an in-memory HTTP server.
function routedFetch(handlers: {
  session: (req: { url: string; init: RequestInit }) => Response | Promise<Response>;
  chat: (req: { url: string; init: RequestInit }) => Response | Promise<Response>;
}) {
  return vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes('/copilot_internal/v2/token')) {
      return handlers.session({ url, init });
    }
    if (url.includes('/chat/completions')) {
      return handlers.chat({ url, init });
    }
    throw new Error(`unrouted fetch: ${url}`);
  }) as unknown as typeof fetch;
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('CopilotProvider', () => {
  it('throws CopilotNoTokenError when user has no GitHub token', async () => {
    const p = new CopilotProvider({
      getGithubToken: () => null,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(p.parseIntent('hi', ctx)).rejects.toBeInstanceOf(CopilotNoTokenError);
  });

  it('exchanges GH token for session token and parses tool_calls', async () => {
    const fetchImpl = routedFetch({
      session: () =>
        json({ token: 'copilot-sess-1', expires_at: Math.floor(Date.now() / 1000) + 1800 }),
      chat: () =>
        json({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'c1',
                    type: 'function',
                    function: {
                      name: 'create_todo',
                      arguments: JSON.stringify({ title: 'milk', scope: 'household' }),
                    },
                  },
                ],
              },
            },
          ],
        }),
    });
    const p = new CopilotProvider({ getGithubToken: () => 'gho_abc', fetchImpl });
    const out = await p.parseIntent('add milk', ctx);
    expect(out).toEqual([
      { tool: 'create_todo', args: { title: 'milk', scope: 'household' } },
    ]);

    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls).toHaveLength(2);
    expect(String(calls[0]![0])).toContain('/copilot_internal/v2/token');
    expect((calls[0]![1] as RequestInit).headers).toMatchObject({ authorization: 'token gho_abc' });
    expect(String(calls[1]![0])).toContain('/chat/completions');
    const chatHeaders = (calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(chatHeaders.authorization).toBe('Bearer copilot-sess-1');
    expect(chatHeaders['copilot-integration-id']).toBe('vscode-chat');
  });

  it('caches session tokens across calls', async () => {
    let sessionCalls = 0;
    const fetchImpl = routedFetch({
      session: () => {
        sessionCalls += 1;
        return json({ token: 'sess-a', expires_at: Math.floor(Date.now() / 1000) + 1800 });
      },
      chat: () => json({ choices: [{ message: { tool_calls: [] } }] }),
    });
    const p = new CopilotProvider({ getGithubToken: () => 'gho_abc', fetchImpl });
    await p.parseIntent('a', ctx);
    await p.parseIntent('b', ctx);
    expect(sessionCalls).toBe(1);
  });

  it('refreshes session token when GitHub token rotates', async () => {
    let sessionCalls = 0;
    let current = 'gho_first';
    const fetchImpl = routedFetch({
      session: () => {
        sessionCalls += 1;
        return json({
          token: `sess-${sessionCalls}`,
          expires_at: Math.floor(Date.now() / 1000) + 1800,
        });
      },
      chat: () => json({ choices: [{ message: { tool_calls: [] } }] }),
    });
    const p = new CopilotProvider({ getGithubToken: () => current, fetchImpl });
    await p.parseIntent('a', ctx);
    current = 'gho_second';
    await p.parseIntent('b', ctx);
    expect(sessionCalls).toBe(2);
  });

  it('throws on chat HTTP error and invalidates cache on 401', async () => {
    let sessionCalls = 0;
    const fetchImpl = routedFetch({
      session: () => {
        sessionCalls += 1;
        return json({ token: `sess-${sessionCalls}`, expires_at: Math.floor(Date.now() / 1000) + 1800 });
      },
      chat: () => json({ error: 'unauthorized' }, 401),
    });
    const p = new CopilotProvider({ getGithubToken: () => 'gho_abc', fetchImpl });
    await expect(p.parseIntent('x', ctx)).rejects.toThrow(/copilot_http_401/);
    // Next call should re-exchange because the 401 cleared the cache.
    await expect(p.parseIntent('y', ctx)).rejects.toThrow(/copilot_http_401/);
    expect(sessionCalls).toBe(2);
  });

  it('drops invalid tool_calls silently', async () => {
    const fetchImpl = routedFetch({
      session: () => json({ token: 's', expires_at: Math.floor(Date.now() / 1000) + 1800 }),
      chat: () =>
        json({
          choices: [
            {
              message: {
                tool_calls: [
                  { function: { name: 'unknown_tool', arguments: '{}' } },
                  { function: { name: 'create_todo', arguments: JSON.stringify({ scope: 'nope' }) } },
                ],
              },
            },
          ],
        }),
    });
    const p = new CopilotProvider({ getGithubToken: () => 'gho_abc', fetchImpl });
    expect(await p.parseIntent('x', ctx)).toEqual([]);
  });
});
