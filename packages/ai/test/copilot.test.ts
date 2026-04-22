import { describe, expect, it, vi } from 'vitest';
import { CopilotProvider, CopilotNoTokenError } from '../src/copilot.js';

const NOW = new Date('2026-04-22T12:00:00Z');
const ctx = { userId: 'u1', now: NOW };

function mockFetch(response: unknown, status = 200) {
  return vi.fn(async () => {
    return new Response(JSON.stringify(response), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('CopilotProvider (GitHub Models backend)', () => {
  it('throws CopilotNoTokenError when user has no GitHub token', async () => {
    const p = new CopilotProvider({
      getGithubToken: () => null,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(p.parseIntent('hi', ctx)).rejects.toBeInstanceOf(CopilotNoTokenError);
  });

  it('calls GitHub Models inference endpoint with the GH token as bearer', async () => {
    const fetchImpl = mockFetch({
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
    });
    const p = new CopilotProvider({ getGithubToken: () => 'gho_abc', fetchImpl });
    const out = await p.parseIntent('add milk', ctx);
    expect(out).toEqual([
      { tool: 'create_todo', args: { title: 'milk', scope: 'household' } },
    ]);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const call = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(String(call[0])).toContain('models.github.ai/inference/chat/completions');
    const init = call[1] as RequestInit;
    expect(init.headers).toMatchObject({ authorization: 'Bearer gho_abc' });
    const body = JSON.parse(init.body as string) as { model: string; tools: unknown[] };
    expect(body.model).toMatch(/^[a-z0-9-]+\/.+/);
    expect(body.tools.length).toBeGreaterThan(0);
  });

  it('respects custom model and base URL', async () => {
    const fetchImpl = mockFetch({ choices: [{ message: { tool_calls: [] } }] });
    const p = new CopilotProvider({
      getGithubToken: () => 'gho_abc',
      model: 'meta/llama-3.1-70b-instruct',
      baseUrl: 'https://models.example.test',
      fetchImpl,
    });
    await p.parseIntent('hi', ctx);
    const call = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(String(call[0])).toBe('https://models.example.test/inference/chat/completions');
    const body = JSON.parse((call[1] as RequestInit).body as string) as { model: string };
    expect(body.model).toBe('meta/llama-3.1-70b-instruct');
  });

  it('returns [] when the model chose no tool', async () => {
    const fetchImpl = mockFetch({
      choices: [{ message: { content: 'hi', tool_calls: [] } }],
    });
    const p = new CopilotProvider({ getGithubToken: () => 'gho_abc', fetchImpl });
    expect(await p.parseIntent('hi', ctx)).toEqual([]);
  });

  it('throws on non-2xx HTTP', async () => {
    const fetchImpl = mockFetch({ error: 'bad' }, 500);
    const p = new CopilotProvider({ getGithubToken: () => 'gho_abc', fetchImpl });
    await expect(p.parseIntent('x', ctx)).rejects.toThrow(/copilot_http_500/);
  });

  it('drops invalid tool_calls silently', async () => {
    const fetchImpl = mockFetch({
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
    });
    const p = new CopilotProvider({ getGithubToken: () => 'gho_abc', fetchImpl });
    expect(await p.parseIntent('x', ctx)).toEqual([]);
  });
});
