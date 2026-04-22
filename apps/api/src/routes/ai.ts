import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { desc, eq } from 'drizzle-orm';
import { schema } from '@home-os/db';
import {
  AiDisabledError,
  CopilotNoTokenError,
  ToolCall,
  createProvider,
  type AiProvider,
} from '@home-os/ai';
import { requireUser } from '../auth/middleware.js';
import { executeToolCall, type ToolOutcome } from '../ai/execute.js';
import { getGithubAccountPublic, makeGithubTokenLookup } from '../github/accounts.js';

const MAX_PROMPT = 2000;
const PARSE_BUCKET_MAX = 8;
const PARSE_BUCKET_WINDOW_MS = 60_000;

const ParseBody = z.object({
  prompt: z.string().min(1).max(MAX_PROMPT),
});

const ExecuteBody = z.object({
  prompt: z.string().min(1).max(MAX_PROMPT),
  toolCalls: z.array(ToolCall).min(1).max(10),
});

// Simple per-user token-bucket rate limit. Scoped to the Fastify instance
// (created fresh in tests via makeTestApp). Protects against runaway LLM
// costs from a misbehaving client.
function makeRateLimiter() {
  const buckets = new Map<string, { count: number; windowStart: number }>();
  return function takeToken(userId: string): boolean {
    const now = Date.now();
    const b = buckets.get(userId);
    if (!b || now - b.windowStart > PARSE_BUCKET_WINDOW_MS) {
      buckets.set(userId, { count: 1, windowStart: now });
      return true;
    }
    if (b.count >= PARSE_BUCKET_MAX) return false;
    b.count += 1;
    return true;
  };
}

export async function registerAiRoutes(app: FastifyInstance) {
  const auth = requireUser(app);
  const { env, db } = app.deps;
  const takeToken = makeRateLimiter();

  const provider: AiProvider = createProvider({
    kind: env.HOME_OS_AI_PROVIDER,
    openai: {
      apiKey: env.HOME_OS_OPENAI_API_KEY,
      model: env.HOME_OS_OPENAI_MODEL,
      baseUrl: env.HOME_OS_OPENAI_BASE_URL,
      fetchImpl: app.deps.fetchImpl,
    },
    copilot: {
      getGithubToken: makeGithubTokenLookup(env, db),
      model: env.HOME_OS_COPILOT_MODEL,
    },
  });
  app.decorate('aiProvider', provider);

  app.get('/api/ai/status', { preHandler: auth }, async (req, reply) => {
    // For Copilot, report whether *this user* has a GitHub connection so the
    // UI can show "Connect GitHub" instead of a generic disabled state.
    const needsGithub = provider.name === 'copilot' && !getGithubAccountPublic(db, req.user!.id);
    return reply.send({
      provider: provider.name,
      enabled: provider.enabled,
      needsGithub,
    });
  });

  app.post('/api/ai/parse', { preHandler: auth }, async (req, reply) => {
    const parsed = ParseBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.format() });
    }
    if (!provider.enabled) {
      return reply.code(503).send({ error: 'ai_disabled', provider: provider.name });
    }
    if (!takeToken(req.user!.id)) {
      return reply.code(429).send({ error: 'rate_limited' });
    }
    try {
      const calls = await provider.parseIntent(parsed.data.prompt, {
        userId: req.user!.id,
        now: new Date(),
      });
      recordTranscript(db, req.user!.id, provider.name, parsed.data.prompt, calls, null);
      return reply.send({ toolCalls: calls });
    } catch (err) {
      if (err instanceof AiDisabledError) {
        return reply.code(503).send({ error: 'ai_disabled' });
      }
      if (err instanceof CopilotNoTokenError) {
        return reply.code(403).send({ error: 'github_not_connected' });
      }
      req.log.warn({ err }, 'ai parse failed');
      return reply.code(502).send({ error: 'provider_error', message: (err as Error).message });
    }
  });

  app.post('/api/ai/execute', { preHandler: auth }, async (req, reply) => {
    const parsed = ExecuteBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.format() });
    }
    const outcomes: ToolOutcome[] = [];
    for (const call of parsed.data.toolCalls) {
      const outcome = await executeToolCall(
        {
          db,
          dataDir: app.deps.dataDir,
          userId: req.user!.id,
          syncCfg: app.calendarSyncCfg,
        },
        call,
      );
      outcomes.push(outcome);
    }
    recordTranscript(
      db,
      req.user!.id,
      provider.name,
      parsed.data.prompt,
      parsed.data.toolCalls,
      outcomes,
    );
    return reply.send({ outcomes });
  });

  app.get('/api/ai/transcripts', { preHandler: auth }, async (req, reply) => {
    const rows = db
      .select()
      .from(schema.aiTranscripts)
      .where(eq(schema.aiTranscripts.userId, req.user!.id))
      .orderBy(desc(schema.aiTranscripts.createdAt))
      .limit(25)
      .all();
    return reply.send({
      transcripts: rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        prompt: r.prompt,
        toolCalls: JSON.parse(r.toolCallsJson) as unknown,
        outcomes: r.outcomeJson ? (JSON.parse(r.outcomeJson) as unknown) : null,
        createdAt: r.createdAt,
      })),
    });
  });
}

function recordTranscript(
  db: FastifyInstance['deps']['db'],
  userId: string,
  provider: string,
  prompt: string,
  toolCalls: ToolCall[],
  outcomes: ToolOutcome[] | null,
) {
  db.insert(schema.aiTranscripts)
    .values({
      id: nanoid(21),
      userId,
      provider,
      prompt,
      toolCallsJson: JSON.stringify(toolCalls),
      outcomeJson: outcomes ? JSON.stringify(outcomes) : null,
    })
    .run();
}

declare module 'fastify' {
  interface FastifyInstance {
    aiProvider: AiProvider;
  }
}
