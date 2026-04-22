import { z } from 'zod';

// ---------------------------------------------------------------------------
// Tool schemas for the AI assistant. Each tool mirrors (a subset of) an
// existing REST endpoint so executor dispatch can reuse domain code.
//
// The zod schemas are the single source of truth. They're:
//   1. validated at parse time (provider output)
//   2. re-validated at execute time (server-side defense-in-depth)
//   3. projected to JSON-schema for OpenAI-style function-calling payloads
//
// plan_meals_week is deferred (plan.md §P9) — its schema is defined but
// it is NOT included in the active ToolCall union.
// ---------------------------------------------------------------------------

export const CreateTodoArgs = z
  .object({
    title: z.string().min(1).max(500),
    scope: z.enum(['household', 'user']).default('household'),
    dueAt: z.string().datetime({ offset: true }).nullable().optional(),
    notes: z.string().max(10_000).nullable().optional(),
  })
  .strict();
export type CreateTodoArgs = z.infer<typeof CreateTodoArgs>;

export const CreateEventArgs = z
  .object({
    title: z.string().min(1).max(1024),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    location: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .strict();
export type CreateEventArgs = z.infer<typeof CreateEventArgs>;

export const ImportRecipeArgs = z
  .object({
    url: z.string().url(),
  })
  .strict();
export type ImportRecipeArgs = z.infer<typeof ImportRecipeArgs>;

export const ToolCall = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('create_todo'), args: CreateTodoArgs }),
  z.object({ tool: z.literal('create_event'), args: CreateEventArgs }),
  z.object({ tool: z.literal('import_recipe'), args: ImportRecipeArgs }),
]);
export type ToolCall = z.infer<typeof ToolCall>;

export type ToolName = ToolCall['tool'];

// -- JSON schema / OpenAI function-calling definitions ---------------------

export interface OpenAIToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const OPENAI_TOOLS: OpenAIToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'create_todo',
      description:
        'Create a new todo. scope=household for shared todos, scope=user for the calling user only.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 500 },
          scope: { type: 'string', enum: ['household', 'user'], default: 'household' },
          dueAt: {
            type: ['string', 'null'],
            description: 'ISO-8601 datetime with offset, e.g. 2026-04-22T18:00:00-04:00',
          },
          notes: { type: ['string', 'null'], maxLength: 10000 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_event',
      description:
        'Create a calendar event on the user primary Google calendar. Non-recurring, timed only. Times must be full ISO-8601 with offset.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'startAt', 'endAt'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 1024 },
          startAt: { type: 'string', description: 'ISO-8601 with offset.' },
          endAt: { type: 'string', description: 'ISO-8601 with offset. Must be > startAt.' },
          location: { type: ['string', 'null'] },
          description: { type: ['string', 'null'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'import_recipe',
      description: 'Import a recipe from a public URL.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['url'],
        properties: {
          url: { type: 'string', format: 'uri' },
        },
      },
    },
  },
];
