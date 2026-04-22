import { describe, expect, it } from 'vitest';
import { ToolCall, CreateReminderArgs, OPENAI_TOOLS } from '../src/tools.js';

describe('create_reminder tool schema', () => {
  it('accepts a minimal valid payload', () => {
    const parsed = ToolCall.parse({
      tool: 'create_reminder',
      args: { title: 'drink water', fireAt: '2099-01-01T10:00:00Z' },
    });
    expect(parsed.tool).toBe('create_reminder');
    if (parsed.tool === 'create_reminder') {
      expect(parsed.args.scope).toBe('user');
    }
  });

  it('rejects fireAt without a timezone offset', () => {
    const res = CreateReminderArgs.safeParse({
      title: 'x',
      fireAt: '2099-01-01 10:00',
    });
    expect(res.success).toBe(false);
  });

  it('is included in the OpenAI tool definitions', () => {
    const names = OPENAI_TOOLS.map((t) => t.function.name);
    expect(names).toContain('create_reminder');
  });
});
