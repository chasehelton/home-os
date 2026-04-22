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

  // Google OAuth (Phase 1). Login is OIDC-only — refresh tokens for
  // calendar arrive in Phase 5 with separate consent.
  HOME_OS_GOOGLE_CLIENT_ID: z.string().optional(),
  HOME_OS_GOOGLE_CLIENT_SECRET: z.string().optional(),
  HOME_OS_GOOGLE_REDIRECT_URI: z
    .string()
    .url()
    .default('http://localhost:4000/auth/google/callback'),
  HOME_OS_ALLOWED_EMAILS: z.string().default(''),

  HOME_OS_AI_PROVIDER: z.string().default('disabled'),
  // Phase 9 — OpenAI adapter. All optional; only used when AI_PROVIDER=openai.
  HOME_OS_OPENAI_API_KEY: z.string().optional(),
  HOME_OS_OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  HOME_OS_OPENAI_BASE_URL: z.string().url().default('https://api.openai.com'),
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
