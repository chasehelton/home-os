import { z } from 'zod';

const EnvSchema = z.object({
  HOME_OS_API_HOST: z.string().default('127.0.0.1'),
  HOME_OS_API_PORT: z.coerce.number().int().positive().default(4000),
  HOME_OS_WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  HOME_OS_SESSION_SECRET: z.string().min(32).default('dev-only-secret-change-me-change-me-change-me'),
  HOME_OS_DATA_DIR: z.string().optional(),
  HOME_OS_AI_PROVIDER: z.string().default('disabled'),
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
