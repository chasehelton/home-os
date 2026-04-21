import { z } from 'zod';

export const User = z.object({
  id: z.string().min(1).max(64),
  email: z.string().email(),
  displayName: z.string().min(1).max(100),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable(),
  createdAt: z.string().datetime(),
});
export type User = z.infer<typeof User>;
