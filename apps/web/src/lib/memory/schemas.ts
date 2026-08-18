import { z } from 'zod';

/**
 * Chapter memory and context-policy schemas (build plan Part 6).
 *
 * `chapterSummarySchema` is the `summarizer` role's structured output for a
 * single published chapter — what happened, who was involved, what changed —
 * per Part 6.1. Its text (not the raw prose) is what gets embedded.
 *
 * `contextPolicySchema` is the per-universe-version knob set from Part 6.3.
 * `retrieval_bias` never drives a branch in retrieval code — it only shapes
 * the instructions given to `summarizer` when a chapter's summary is
 * generated (see prompts.ts), so retrieval itself stays universe-agnostic.
 */

export const chapterSummarySchema = z.object({
  what_happened: z.string().min(1),
  who_was_involved: z.array(z.string().min(1)),
  what_changed: z.array(z.string().min(1)),
});

export type ChapterSummary = z.infer<typeof chapterSummarySchema>;

/** Arc summaries are stored as plain text (`arc_summaries.summary`), unlike
 * the structured per-chapter shape — an arc is already a compression of
 * several structured summaries, so a second layer of structure would just
 * re-encode the same prose. */
export const arcSummaryResultSchema = z.object({
  summary: z.string().min(1),
});

export type ArcSummaryResult = z.infer<typeof arcSummaryResultSchema>;

export const retrievalBiasSchema = z.enum(['precedent', 'information', 'emotional', 'thematic']);

export type RetrievalBias = z.infer<typeof retrievalBiasSchema>;

export const canonCompressionSchema = z.enum(['full', 'summary', 'rules_only']);

export type CanonCompression = z.infer<typeof canonCompressionSchema>;

export const contextPolicySchema = z.object({
  recent_chapters: z.number().int().positive(),
  retrieved_chapters: z.number().int().nonnegative(),
  retrieval_bias: retrievalBiasSchema,
  canon_compression: canonCompressionSchema,
  token_budget: z.number().int().positive(),
});

export type ContextPolicy = z.infer<typeof contextPolicySchema>;

/** Must match the migration default in 20260819000002_context_policy.sql exactly. */
export const DEFAULT_CONTEXT_POLICY: ContextPolicy = {
  recent_chapters: 3,
  retrieved_chapters: 5,
  retrieval_bias: 'precedent',
  canon_compression: 'full',
  token_budget: 24_000,
};
