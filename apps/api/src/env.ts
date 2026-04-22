import { z } from 'zod';

const EnvSchema = z.object({
  HOME_OS_API_HOST: z.string().default('127.0.0.1'),
  HOME_OS_API_PORT: z.coerce.number().int().positive().default(4000),
  HOME_OS_WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  HOME_OS_SESSION_SECRET: z
    .string()
    .min(32)
    .default('dev-only-secret-change-me-change-me-change-me'),
  HOME_OS_DATA_DIR: z.string().optional(),
  // Phase 10 — deployment.
  //   * In dev/test we auto-run pending migrations on startup (ergonomic).
  //   * In production the compose stack uses a one-shot `migrate` service
  //     that runs `pnpm --filter=@home-os/db migrate:safe` (snapshot +
  //     destructive-migration gate) before the api container starts. We set
  //     this to 'false' there so the server never silently applies schema
  //     changes to restored data.
  HOME_OS_AUTO_MIGRATE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // Google OAuth (Phase 1). Login is OIDC-only — refresh tokens for
  // calendar arrive in Phase 5 with separate consent.
  HOME_OS_GOOGLE_CLIENT_ID: z.string().optional(),
  HOME_OS_GOOGLE_CLIENT_SECRET: z.string().optional(),
  HOME_OS_GOOGLE_REDIRECT_URI: z
    .string()
    .url()
    .default('http://localhost:4000/auth/google/callback'),
  HOME_OS_ALLOWED_EMAILS: z.string().default(''),

  // Phase 9 — AI assistant.
  //   'copilot' (default): GitHub Copilot using per-user GitHub OAuth device-flow
  //   'openai' : OpenAI Chat Completions
  //   'mock'   : deterministic local provider for tests/dev
  //   'disabled'
  HOME_OS_AI_PROVIDER: z.string().default('copilot'),
  // OpenAI adapter (only used when AI_PROVIDER=openai).
  HOME_OS_OPENAI_API_KEY: z.string().optional(),
  HOME_OS_OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  HOME_OS_OPENAI_BASE_URL: z.string().url().default('https://api.openai.com'),
  // GitHub Copilot adapter — backed by the public GitHub Models API
  // (https://docs.github.com/en/rest/models). Users auth via per-user
  // OAuth device flow; their GitHub token is then passed to the official
  // `@github/copilot-sdk` (which spawns the Copilot CLI under the hood).
  //   CLIENT_ID defaults to the VS Code device-flow client (public, issues
  //   tokens with the `read:user` scope we ask for). Override only if you
  //   registered your own GitHub OAuth app.
  //   MODEL is an SDK-native model identifier (e.g. "gpt-5", "claude-sonnet-4.5").
  HOME_OS_GITHUB_CLIENT_ID: z.string().default('Iv1.b507a08c87ecfe98'),
  HOME_OS_COPILOT_MODEL: z.string().default('gpt-5'),
  // Phase 5: 32-byte key (hex or base64) used to encrypt Google refresh
  // tokens at rest. REQUIRED in production; derived from the session secret
  // in dev/test for ergonomics.
  HOME_OS_TOKEN_KEY: z.string().optional(),
  // How often the background sync worker fires. Default 5 min.
  HOME_OS_CALENDAR_SYNC_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 60 * 1000),

  // Phase 11 — Reminders & Web Push.
  //   * VAPID keys are optional; if unset, push is disabled (vapid-public-key
  //     endpoint 503s) and the banner-polling path still works.
  //   * SUBJECT must be a mailto: or https: URL identifying the app owner
  //     (RFC 8292). In dev we default to a mailto: placeholder.
  //   * TICK_MS controls the reminder worker's polling cadence.
  HOME_OS_VAPID_PUBLIC_KEY: z.string().optional(),
  HOME_OS_VAPID_PRIVATE_KEY: z.string().optional(),
  HOME_OS_VAPID_SUBJECT: z.string().default('mailto:home-os@localhost'),
  HOME_OS_REMINDER_TICK_MS: z.coerce.number().int().positive().default(20_000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export function allowedEmails(env: Env): Set<string> {
  return new Set(
    env.HOME_OS_ALLOWED_EMAILS.split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}
