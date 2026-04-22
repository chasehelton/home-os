export * from './tools.js';
export * from './provider.js';
export { MockProvider } from './mock.js';
export { OpenAIProvider, type OpenAIProviderOptions } from './openai.js';
export {
  CopilotProvider,
  CopilotNoTokenError,
  type CopilotProviderOptions,
  type GithubTokenProvider,
} from './copilot.js';

import { DisabledProvider, type AiProvider } from './provider.js';
import { MockProvider } from './mock.js';
import { OpenAIProvider } from './openai.js';
import { CopilotProvider, type GithubTokenProvider } from './copilot.js';

export interface CreateProviderOptions {
  /** One of: 'disabled' | 'mock' | 'openai' | 'copilot'. Empty/undefined = disabled. */
  kind: string | undefined;
  openai?: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
  };
  copilot?: {
    getGithubToken?: GithubTokenProvider;
    model?: string;
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
        // rest of the app still works.
        return new DisabledProvider();
      }
      return new OpenAIProvider({
        apiKey: key,
        model: opts.openai?.model,
        baseUrl: opts.openai?.baseUrl,
        fetchImpl: opts.openai?.fetchImpl,
      });
    }
    case 'copilot': {
      const getGithubToken = opts.copilot?.getGithubToken;
      if (!getGithubToken) {
        // No token provider wired — degrade to disabled. CopilotProvider is
        // per-user, so the provider itself is "enabled" even when a given
        // user hasn't connected GitHub yet (that's a per-request error).
        return new DisabledProvider();
      }
      return new CopilotProvider({
        getGithubToken,
        model: opts.copilot?.model,
      });
    }
    case 'anthropic':
      throw new Error(`AI provider "${kind}" is not yet implemented.`);
    default:
      throw new Error(`Unknown AI provider "${kind}".`);
  }
}
