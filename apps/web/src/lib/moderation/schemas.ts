import { z } from 'zod';

export const moderationResultSchema = z.object({
  verdict: z.enum(['pass', 'flag', 'block']),
  reason: z.string(),
});

export type ModerationResult = z.infer<typeof moderationResultSchema>;
