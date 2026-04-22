import { describe, expect, it } from 'vitest';
import { MockProvider } from '../src/mock.js';

const NOW = new Date('2026-04-22T12:00:00Z');
const ctx = { userId: 'u1', now: NOW };

describe('MockProvider', () => {
  const p = new MockProvider();

  it('parses a shared todo', async () => {
    const out = await p.parseIntent('add milk to the shared todo list', ctx);
    expect(out).toEqual([{ tool: 'create_todo', args: { title: 'milk', scope: 'household' } }]);
  });

  it('parses a personal todo when "my" is present', async () => {
    const out = await p.parseIntent('add a task for me: call mom', ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ tool: 'create_todo' });
    expect(out[0]).toHaveProperty('args.scope', 'user');
  });

  it('parses import_recipe from a URL', async () => {
    const out = await p.parseIntent('import recipe https://example.com/cookie-bars', ctx);
    expect(out).toEqual([
      { tool: 'import_recipe', args: { url: 'https://example.com/cookie-bars' } },
    ]);
  });

  it('parses create_event and gives sane default times', async () => {
    const out = await p.parseIntent('schedule dinner with Sam', ctx);
    expect(out).toHaveLength(1);
    expect(out[0]?.tool).toBe('create_event');
    const args = (out[0] as { args: { startAt: string; endAt: string } }).args;
    expect(new Date(args.startAt).valueOf()).toBeGreaterThan(NOW.valueOf());
    expect(new Date(args.endAt).valueOf()).toBeGreaterThan(new Date(args.startAt).valueOf());
  });

  it('returns empty for unrecognized prompts', async () => {
    expect(await p.parseIntent('what is the weather today?', ctx)).toEqual([]);
    expect(await p.parseIntent('', ctx)).toEqual([]);
  });
});
