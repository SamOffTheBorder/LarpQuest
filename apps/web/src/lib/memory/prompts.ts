import type { RetrievalBias } from '@/lib/memory/schemas';

/**
 * Chapter and arc summary prompts.
 *
 * Retrieval bias (build plan Part 6.3) is expressed here, as an instruction
 * appended to the summary prompt, and nowhere else. Retrieval itself
 * (retrieval.ts) always ranks by the same cosine-similarity mechanism for
 * every universe — biasing what the summaries emphasize is what makes
 * retrieval feel biased, without a single conditional in the retrieval code
 * path. This function branches on `RetrievalBias`, a policy value, never on a
 * genre, universe name, or media type.
 */

const BIAS_INSTRUCTIONS: Record<RetrievalBias, string> = {
  precedent:
    'Emphasize precedent-setting outcomes: what was established as possible, ' +
    'impossible, or costly by what happened, since future turns may need to ' +
    'know "how did this work before."',
  information:
    'Emphasize what was revealed or discovered: new information, clues, or ' +
    'facts that became known, since future turns may need to know "what has ' +
    'been revealed so far."',
  emotional:
    'Emphasize relationships and emotional state: how characters\' feelings ' +
    'toward each other shifted, since future turns may need to know "what is ' +
    'the history between these characters."',
  thematic:
    'Emphasize recurring motifs and thematic throughlines, since future turns ' +
    'may need to know "what themes are running through this story."',
};

export interface SummaryChapterInput {
  turnNumber: number;
  prose: string;
}

export interface SummaryEntityInput {
  name: string;
  type: string;
}

export const CHAPTER_SUMMARY_SYSTEM_PROMPT = [
  'You are summarizing one chapter of a collaborative fiction story for use as',
  'retrievable context in later chapters. Report what happened, who was',
  'involved, and what changed — concretely, not as vague scene-setting.',
  '',
  'Respond with JSON only, matching the required schema exactly.',
].join('\n');

export function buildChapterSummaryPrompt(
  chapter: SummaryChapterInput,
  entities: readonly SummaryEntityInput[],
  bias: RetrievalBias,
): string {
  const entityList =
    entities.length > 0
      ? entities.map((entity) => `- ${entity.name} (${entity.type})`).join('\n')
      : '(no entities recorded for this story)';

  return [
    `Chapter ${chapter.turnNumber}:`,
    chapter.prose,
    '',
    'Known entities in this story:',
    entityList,
    '',
    BIAS_INSTRUCTIONS[bias],
  ].join('\n');
}

export const ARC_SUMMARY_SYSTEM_PROMPT = [
  'You are summarizing a multi-chapter arc of a collaborative fiction story,',
  'from its per-chapter summaries, for use as long-range retrievable context.',
  'Compress the arc into what a reader would need to know without having read',
  'the individual chapters: the throughline, what changed by the end, and any',
  'unresolved threads.',
  '',
  'Respond with JSON only, matching the required schema exactly.',
].join('\n');

export interface ArcChapterSummaryInput {
  turnNumber: number;
  summary: string;
}

export function buildArcSummaryPrompt(
  chapterSummaries: readonly ArcChapterSummaryInput[],
  bias: RetrievalBias,
): string {
  const body = chapterSummaries
    .map((chapter) => `Chapter ${chapter.turnNumber}: ${chapter.summary}`)
    .join('\n');

  return [body, '', BIAS_INSTRUCTIONS[bias]].join('\n');
}
