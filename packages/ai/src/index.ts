import { z } from 'zod';

// ---------------------------------------------------------------------------
// Provider-agnostic AI abstraction. Full impl lands in Phase 9 (plan.md).
// The app must be fully functional with the `disabled` provider.
// ---------------------------------------------------------------------------

export const ToolCall = z.discriminatedUnion('tool', [
  z.object({
    tool: z.literal('create_todo'),
    args: z.object({
      title: z.string(),
      scope: z.enum(['household', 'user']).default('household'),
      dueAt: z.string().datetime().nullable().optional(),
      notes: z.string().nullable().optional(),
    }),
  }),
  z.object({
    tool: z.literal('create_event'),
    args: z.object({
      title: z.string(),
      startAt: z.string().datetime(),
      endAt: z.string().datetime(),
      location: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
    }),
  }),
  z.object({
    tool: z.literal('import_recipe'),
    args: z.object({ url: z.string().url() }),
  }),
  z.object({
    tool: z.literal('plan_meals_week'),
    args: z.object({
      weekStart: z.string().date(),
      preferences: z.string().nullable().optional(),
    }),
  }),
]);
export type ToolCall = z.infer<typeof ToolCall>;

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
    throw new Error('AI provider is disabled. Set HOME_OS_AI_PROVIDER to enable.');
  }
}

export function createProvider(kind: string | undefined): AiProvider {
  switch (kind) {
    case undefined:
    case '':
    case 'disabled':
      return new DisabledProvider();
    // copilot / openai / anthropic adapters land in Phase 9.
    default:
      throw new Error(`AI provider "${kind}" is not yet implemented.`);
  }
}
