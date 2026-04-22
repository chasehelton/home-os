import { describe, expect, it } from 'vitest';
import { createProvider, DisabledProvider, AiDisabledError } from '../src/index.js';

describe('createProvider', () => {
  it('defaults to disabled', () => {
    expect(createProvider({ kind: undefined })).toBeInstanceOf(DisabledProvider);
    expect(createProvider({ kind: '' })).toBeInstanceOf(DisabledProvider);
    expect(createProvider({ kind: 'disabled' })).toBeInstanceOf(DisabledProvider);
  });

  it('returns mock for kind=mock', () => {
    const p = createProvider({ kind: 'mock' });
    expect(p.name).toBe('mock');
    expect(p.enabled).toBe(true);
  });

  it('falls back to disabled when openai key is missing', () => {
    const p = createProvider({ kind: 'openai', openai: {} });
    expect(p).toBeInstanceOf(DisabledProvider);
  });

  it('throws for unknown or unimplemented providers', () => {
    expect(() => createProvider({ kind: 'copilot' })).toThrow();
    expect(() => createProvider({ kind: 'anthropic' })).toThrow();
    expect(() => createProvider({ kind: 'nope' })).toThrow();
  });

  it('DisabledProvider.parseIntent throws AiDisabledError', async () => {
    const p = new DisabledProvider();
    await expect(p.parseIntent()).rejects.toBeInstanceOf(AiDisabledError);
  });
});
