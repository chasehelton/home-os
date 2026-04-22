export * from './tools.js';
export * from './provider.js';
export { MockProvider } from './mock.js';
export { OpenAIProvider, type OpenAIProviderOptions } from './openai.js';

import { DisabledProvider, type AiProvider } from './provider.js';
import { MockProvider } from './mock.js';
import { OpenAIProvider } from './openai.js';

export interface CreateProviderOptions {
  /** One of: 'disabled' | 'mock' | 'openai'. Empty/undefined = disabled. */
  kind: string | undefined;
  openai?: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
  };
}

export function createProvider(opts: CreateProviderOptions): AiProvider {
  const kind = (opts.kind ?? '').toLowerCase();
  switch (kind) {
    case '':
    case 'disabled':
      return new DisabledProvider();
    case 'mock':
      return new MockProvider();
    case 'openai': {
      const key = opts.openai?.apiKey;
      if (!key) {
        // No key — degrade to disabled rather than throwing at boot so the
        // rest of the app still works. The /api/ai/parse route will return
        // an ai_disabled error until a key is configured.
        return new DisabledProvider();
      }
      return new OpenAIProvider({
        apiKey: key,
        model: opts.openai?.model,
        baseUrl: opts.openai?.baseUrl,
        fetchImpl: opts.openai?.fetchImpl,
      });
    }
    case 'copilot':
    case 'anthropic':
      // Adapter stubs — land in a follow-up per plan.md §P9.
      throw new Error(`AI provider "${kind}" is not yet implemented.`);
    default:
      throw new Error(`Unknown AI provider "${kind}".`);
  }
}
