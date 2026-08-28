import { z } from 'zod';

import { CONTENT_RATINGS } from '@/lib/engine/content-ratings';

/**
 * The premise document and the intent that produces it.
 *
 * Pure schemas, no server dependency, so both the server actions and the
 * review components can import them.
 *
 * Deliberately mirrors `lib/research/draft.ts`: the same four review statuses
 * and the same `{ status, content, editedContent? }` section wrapper. The
 * premise review UI is the universe review UI at a smaller scale, and sharing
 * the shape is what keeps the two from drifting apart.
 *
 * Note what is *not* here: no genre, media type, or universe vocabulary of
 * any kind. Intent is captured as open text and numbers only, so nothing
 * downstream can branch on a genre token (CLAUDE.md constraint #1) — the
 * guidance comes from what each field asks, not from a menu of answers.
 */

export const PREMISE_SECTION_KEYS = [
  'tldr',
  'setting',
  'openingSituation',
  'cast',
  'hooks',
  'toneGuidance',
] as const;

export type PremiseSectionKey = (typeof PREMISE_SECTION_KEYS)[number];

const sectionStatusSchema = z.enum(['pending', 'accepted', 'edited', 'rejected']);
export type SectionStatus = z.infer<typeof sectionStatusSchema>;

function section<T extends z.ZodTypeAny>(content: T) {
  return z.object({
    status: sectionStatusSchema.default('pending'),
    content,
    /** Present only when status is 'edited' — the user's replacement value. */
    editedContent: content.optional(),
  });
}

export const MIN_CAST_SIZE = 1;
export const MAX_CAST_SIZE = 8;

/**
 * What the GM tells us before anything is generated.
 *
 * `pitch` is the primary field; the rest are optional refinements behind a
 * disclosure. At least one of `pitch` / `settingSketch` must be present —
 * generating from nothing at all produces generic filler, and the refinement
 * fields alone are too thin to write a premise from.
 */
export const premiseInputSchema = z
  .object({
    pitch: z.string().trim().max(2000, 'Pitch is too long.').default(''),
    settingSketch: z.string().trim().max(1000, 'Setting sketch is too long.').default(''),
    toneNotes: z.string().trim().max(1000, 'Tone notes are too long.').default(''),
    mustInclude: z.string().trim().max(1000, 'Must-include is too long.').default(''),
    mustAvoid: z.string().trim().max(1000, 'Must-avoid is too long.').default(''),
    castSize: z.coerce
      .number()
      .int('Cast size must be a whole number.')
      .min(MIN_CAST_SIZE, `Cast size must be at least ${MIN_CAST_SIZE}.`)
      .max(MAX_CAST_SIZE, `Cast size must be at most ${MAX_CAST_SIZE}.`)
      .default(3),
    contentRating: z.enum(CONTENT_RATINGS),
    universeId: z.string().uuid().nullable().default(null),
  })
  .refine((input) => input.pitch.length > 0 || input.settingSketch.length > 0, {
    message: 'Describe the story you want, or sketch its setting.',
    path: ['pitch'],
  });

export type PremiseInput = z.infer<typeof premiseInputSchema>;

/**
 * One proposed cast member.
 *
 * `type` is the entity type this seeds on approval — free text chosen by the
 * model to suit the story, never an enum the engine knows about. `data` is
 * opaque to the engine exactly as `entities.data` is.
 *
 * `kept` carries the per-member cut state (design.md decision 9). The cast is
 * the one section that is a list of independent things rather than a single
 * piece of prose, and "I like two of these three" is the most likely single
 * piece of feedback in the whole flow — cutting the section wholesale to
 * remove one character would throw away two good ones. A cut member is
 * retained here rather than deleted, so the cut is reversible and so
 * regeneration can see what was rejected instead of silently reproposing it.
 */
export const premiseCastMemberSchema = z.object({
  name: z.string().trim().min(1),
  type: z.string().trim().min(1),
  role: z.string().trim().min(1),
  description: z.string().trim().min(1),
  kept: z.boolean().default(true),
});

export type PremiseCastMember = z.infer<typeof premiseCastMemberSchema>;

/**
 * The document the model returns, section by section.
 *
 * Every section is required — unlike a research draft, where sections appear
 * as their stages complete, a premise arrives from one call and is either
 * whole or a validation failure.
 */
export const premiseDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  tldr: section(z.string().trim().min(1)),
  setting: section(z.string().trim().min(1)),
  openingSituation: section(z.string().trim().min(1)),
  cast: section(z.array(premiseCastMemberSchema)),
  hooks: section(z.array(z.string().trim().min(1))),
  toneGuidance: section(z.string().trim().min(1)),
});

export type PremiseDocument = z.infer<typeof premiseDocumentSchema>;

/**
 * What the model is asked to produce.
 *
 * The review status lives on the stored document, not in the model's output —
 * asking a model to emit `status: 'pending'` six times is a pointless token
 * cost and one more field it can get wrong. `fromGenerated` adds the wrappers.
 */
export const generatedPremiseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  tldr: z.string().trim().min(1),
  setting: z.string().trim().min(1),
  openingSituation: z.string().trim().min(1),
  cast: z.array(
    z.object({
      name: z.string().trim().min(1),
      type: z.string().trim().min(1),
      role: z.string().trim().min(1),
      description: z.string().trim().min(1),
    }),
  ),
  hooks: z.array(z.string().trim().min(1)),
  toneGuidance: z.string().trim().min(1),
});

export type GeneratedPremise = z.infer<typeof generatedPremiseSchema>;

/** Wrap a freshly generated premise as an all-pending document. */
export function fromGenerated(generated: GeneratedPremise): PremiseDocument {
  return premiseDocumentSchema.parse({
    title: generated.title,
    tldr: { status: 'pending', content: generated.tldr },
    setting: { status: 'pending', content: generated.setting },
    openingSituation: { status: 'pending', content: generated.openingSituation },
    cast: {
      status: 'pending',
      content: generated.cast.map((member) => ({ ...member, kept: true })),
    },
    hooks: { status: 'pending', content: generated.hooks },
    toneGuidance: { status: 'pending', content: generated.toneGuidance },
  });
}

/**
 * A section's effective content: the user's edit where they made one, the
 * generated content otherwise.
 *
 * `editedContent` is stored alongside `content` rather than replacing it, so
 * the original generated value stays recoverable — the same discipline
 * `lib/research/review.ts` applies.
 */
export function effectiveContent<K extends PremiseSectionKey>(
  document: PremiseDocument,
  key: K,
): PremiseDocument[K]['content'] {
  const target = document[key];
  return target.status === 'edited' && target.editedContent !== undefined
    ? target.editedContent
    : target.content;
}

/** A section counts as pinned when the owner has settled it. */
export function isPinned(status: SectionStatus): boolean {
  return status === 'accepted' || status === 'edited';
}

/** The cast members that would seed entities on approval. */
export function keptCast(document: PremiseDocument): PremiseCastMember[] {
  if (document.cast.status === 'rejected') {
    return [];
  }
  return effectiveContent(document, 'cast').filter((member) => member.kept);
}
