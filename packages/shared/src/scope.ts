import { z } from 'zod';

export const Scope = z.enum(['household', 'user']);
export type Scope = z.infer<typeof Scope>;
