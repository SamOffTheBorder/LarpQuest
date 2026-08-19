import { z } from 'zod';

/**
 * The Gatekeeper's structured verdict (build plan Part 5.4, gatekeeper
 * capability). `imposed_limits`/`suggested_alternative`/`narrative_cost` are
 * all optional — only `allow_with_limits` typically populates
 * `imposed_limits`, and a plain `allow` may have neither of the others.
 */
export const gatekeeperVerdictSchema = z.object({
  verdict: z.enum(['allow', 'allow_with_limits', 'reject']),
  reasoning: z.string().min(1),
  imposed_limits: z.array(z.string().min(1)).optional(),
  suggested_alternative: z.string().min(1).optional(),
  narrative_cost: z.string().min(1).optional(),
});

export type GatekeeperVerdict = z.infer<typeof gatekeeperVerdictSchema>;
