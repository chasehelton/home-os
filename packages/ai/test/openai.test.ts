import { describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../src/openai.js';

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

describe('OpenAIProvider', () => {
  it('parses a tool_call into a validated ToolCall', async () => {
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
    const p = new OpenAIProvider({ apiKey: 'sk-test', fetchImpl });
    const out = await p.parseIntent('add milk', ctx);
    expect(out).toEqual([{ tool: 'create_todo', args: { title: 'milk', scope: 'household' } }]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const call = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(String(call[0])).toContain('/v1/chat/completions');
    const init = call[1] as RequestInit;
    expect(init.headers).toMatchObject({ authorization: 'Bearer sk-test' });
    const body = JSON.parse(init.body as string) as { tools: unknown[]; tool_choice: string };
    expect(body.tools.length).toBeGreaterThan(0);
    expect(body.tool_choice).toBe('auto');
  });

  it('drops invalid tool_calls silently', async () => {
    const fetchImpl = mockFetch({
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: { name: 'create_todo', arguments: JSON.stringify({ scope: 'nope' }) },
              },
              {
                function: { name: 'unknown_tool', arguments: '{}' },
              },
            ],
          },
        },
      ],
    });
    const p = new OpenAIProvider({ apiKey: 'sk-test', fetchImpl });
    expect(await p.parseIntent('x', ctx)).toEqual([]);
  });

  it('returns [] when the model chose no tool', async () => {
    const fetchImpl = mockFetch({
      choices: [{ message: { content: 'hi', tool_calls: [] } }],
    });
    const p = new OpenAIProvider({ apiKey: 'sk-test', fetchImpl });
    expect(await p.parseIntent('hi', ctx)).toEqual([]);
  });

  it('throws on non-2xx HTTP', async () => {
    const fetchImpl = mockFetch({ error: 'bad' }, 500);
    const p = new OpenAIProvider({ apiKey: 'sk-test', fetchImpl });
    await expect(p.parseIntent('x', ctx)).rejects.toThrow(/openai_http_500/);
  });
});
