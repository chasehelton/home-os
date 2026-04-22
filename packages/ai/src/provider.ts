import type { ToolCall } from './tools.js';

export interface AiContext {
  userId: string;
  now: Date;
}

export interface AiProvider {
  readonly name: string;
  readonly enabled: boolean;
  parseIntent(prompt: string, ctx: AiContext): Promise<ToolCall[]>;
}

export class DisabledProvider implements AiProvider {
  readonly name = 'disabled';
  readonly enabled = false;
  async parseIntent(): Promise<ToolCall[]> {
    throw new AiDisabledError();
  }
}

export class AiDisabledError extends Error {
  readonly code = 'ai_disabled';
  constructor() {
    super('AI provider is disabled. Set HOME_OS_AI_PROVIDER to enable.');
    this.name = 'AiDisabledError';
  }
}
