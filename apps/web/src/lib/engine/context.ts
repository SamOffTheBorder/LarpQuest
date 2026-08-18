/**
 * Context assembly — the most important function in the codebase.
 *
 * `assembleContext` is a PURE function of its persisted inputs. It performs no
 * writes and its output is never stored: a stored context goes stale
 * immediately, and stale context is exactly the drift the architecture exists
 * to prevent.
 *
 * Phase 4 adds retrieval (a RETRIEVED section built from `retrievedSummaries`)
 * and canon compression, without changing this function's purity: retrieval
 * and compression both happen upstream (retrieval.ts, universe-version
 * publish), and this function only ever reads text and numbers it's handed —
 * no DB read, no embedding call, here. Every existing caller that omits the
 * new optional inputs gets byte-identical Phase 1 output (context.test.ts's
 * regression guard).
 */

/** Entity `data` is opaque. The engine never inspects field names. */
export type EntityData = Record<string, unknown>;

export interface ContextEntity {
  id: string;
  type: string;
  name: string;
  status: string;
  data: EntityData;
}

export interface ContextChapter {
  turnNumber: number;
  prose: string;
}

export interface ContextSubmission {
  entityName: string | null;
  content: string;
}

export interface ContextStory {
  title: string;
  /** Free text. In Phase 1 this stands in for the Canon layer. */
  toneDirectives: string | null;
  worldLedger: Record<string, unknown>;
  /**
   * Resolved canon bible text — already compressed to whatever
   * `context_policy.canonCompression` calls for, or the full bible, by the
   * caller. `assembleContext` never reads `canon_compression` or fetches this
   * itself; it only renders what it's handed, preserving purity.
   */
  canonBibleText?: string | null;
}

export interface ContextTurn {
  turnNumber: number;
  mode: string;
  sceneSetup: string | null;
}

/** A retrieved chapter or arc summary, ranked by similarity to the current turn's input. */
export interface ContextRetrievedSummary {
  /** The chapter this summary covers (its turnNumber for a chapter summary,
   * or its toChapter for an arc summary) — used to dedupe against RECENT. */
  turnNumber: number;
  /** Null for an arc summary, which covers a range rather than one chapter. */
  arcRange?: { fromChapter: number; toChapter: number };
  summary: string;
  similarity: number;
}

export interface AssembleContextInput {
  story: ContextStory;
  turn: ContextTurn;
  entities: readonly ContextEntity[];
  /** Most recent last. Trimmed to `recentChapterCount` and to fit the budget. */
  recentChapters: readonly ContextChapter[];
  /** Top-K by similarity, already ranked by the caller (retrieval.ts). Any
   * entry whose turnNumber is already covered by RECENT is excluded when
   * rendering, so the same chapter never appears twice. */
  retrievedSummaries?: readonly ContextRetrievedSummary[];
  submissions: readonly ContextSubmission[];
  policy?: ContextPolicy;
}

export interface ContextPolicy {
  recentChapters: number;
  tokenBudget: number;
  retrievedChapters?: number;
  retrievalBias?: string;
  canonCompression?: string;
}

export const DEFAULT_CONTEXT_POLICY: ContextPolicy = {
  recentChapters: 3,
  tokenBudget: 24_000,
  retrievedChapters: 5,
  retrievalBias: 'precedent',
  canonCompression: 'full',
};

export interface AssembledContext {
  prompt: string;
  estimatedTokens: number;
  /** Chapters omitted to fit the budget. Surfaced so the drop is visible. */
  droppedChapters: number;
  /** Retrieved summaries omitted to fit the budget, or excluded as duplicates of a RECENT chapter. */
  droppedRetrievedSummaries: number;
}

export class ContextBudgetError extends Error {
  constructor(
    readonly requiredTokens: number,
    readonly tokenBudget: number,
  ) {
    super(
      `Required context is ${requiredTokens} tokens but the budget is ${tokenBudget}. ` +
        'Entity state, world ledger, and this turn\'s submissions cannot be dropped. ' +
        'Raise the budget or reduce active entities.',
    );
    this.name = 'ContextBudgetError';
  }
}

/**
 * Token estimate.
 *
 * A ~4-chars-per-token approximation with a safety margin, rather than exact
 * per-model tokenization. Budget enforcement only needs to be conservative,
 * and an exact count would tie assembly to a specific tokenizer.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function renderEntity(entity: ContextEntity): string {
  // `data` is serialized as-is. No branching on field names, ever — that is
  // what lets one engine run every genre.
  const data = JSON.stringify(entity.data, null, 2);
  return `### ${entity.name} (${entity.type})\nStatus: ${entity.status}\n${data}`;
}

function renderSubmission(submission: ContextSubmission, index: number): string {
  const who = submission.entityName ?? 'Unassigned';
  return `${index + 1}. [${who}] ${submission.content}`;
}

function renderChapter(chapter: ContextChapter): string {
  return `### Chapter ${chapter.turnNumber}\n${chapter.prose}`;
}

function renderRetrievedSummary(entry: ContextRetrievedSummary): string {
  const label =
    entry.arcRange !== undefined
      ? `Chapters ${entry.arcRange.fromChapter}-${entry.arcRange.toChapter}`
      : `Chapter ${entry.turnNumber}`;
  return `### ${label}\n${entry.summary}`;
}

/**
 * Assemble the prompt for a turn.
 *
 * Content is dropped in a defined priority order when over budget: oldest
 * chapters first, whole records only. Entity state, the world ledger, and the
 * current turn's submissions are never dropped — if those alone exceed the
 * budget, this throws rather than silently sending an over-budget prompt.
 */
export function assembleContext(input: AssembleContextInput): AssembledContext {
  const policy = input.policy ?? DEFAULT_CONTEXT_POLICY;
  const { story, turn, entities, submissions } = input;

  const activeEntities = entities.filter((entity) => entity.status === 'active');

  // --- Required sections, in prompt order ---
  const header = `# Story: ${story.title}`;

  const tone =
    story.toneDirectives !== null && story.toneDirectives.length > 0
      ? `## Tone\n${story.toneDirectives}\n\nMaintain this register.`
      : null;

  const canonSection =
    story.canonBibleText !== undefined && story.canonBibleText !== null && story.canonBibleText.length > 0
      ? `## Canon Bible\n${story.canonBibleText}`
      : null;

  const entitySection =
    activeEntities.length > 0
      ? `## Current State\n${activeEntities.map(renderEntity).join('\n\n')}`
      : '## Current State\n(no active entities)';

  const ledgerSection = `## World Ledger\n${JSON.stringify(story.worldLedger, null, 2)}`;

  const turnSection = [
    '## This Turn',
    `Mode: ${turn.mode}`,
    turn.sceneSetup !== null && turn.sceneSetup.length > 0
      ? `Scene: ${turn.sceneSetup}`
      : null,
    '',
    'Player actions:',
    submissions.length > 0
      ? submissions.map(renderSubmission).join('\n')
      : '(none submitted)',
  ]
    .filter((part): part is string => part !== null)
    .join('\n');

  const constraints = [
    '## Constraints',
    '- Every player action must be meaningfully addressed',
    '- Respect established state; do not contradict the world ledger',
    '- Write the chapter as prose, not a summary',
  ].join('\n');

  const requiredParts = [header, canonSection, tone, entitySection, ledgerSection, turnSection, constraints].filter(
    (part): part is string => part !== null,
  );

  const requiredTokens = requiredParts.reduce(
    (sum, part) => sum + estimateTokens(part),
    0,
  );

  if (requiredTokens > policy.tokenBudget) {
    throw new ContextBudgetError(requiredTokens, policy.tokenBudget);
  }

  // --- Optional: recent chapters, newest kept first when trimming ---
  const candidates = input.recentChapters.slice(-policy.recentChapters);

  let remaining = policy.tokenBudget - requiredTokens;
  const kept: ContextChapter[] = [];

  // Walk newest-to-oldest so the oldest are the ones dropped.
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const chapter = candidates[i];
    if (chapter === undefined) {
      continue;
    }

    const cost = estimateTokens(renderChapter(chapter));

    if (cost > remaining) {
      break; // Whole chapters only — never a partial record.
    }

    remaining -= cost;
    kept.unshift(chapter);
  }

  const droppedChapters = candidates.length - kept.length;

  const recentSection =
    kept.length > 0 ? `## Recent Events\n${kept.map(renderChapter).join('\n\n')}` : null;

  // --- Optional: retrieved summaries, lower priority than recent full-prose
  // chapters (Part 6.2's ALWAYS > RECENT > RETRIEVED). Excludes any chapter
  // already covered by RECENT so the same chapter never appears twice.
  const keptTurnNumbers = new Set(kept.map((chapter) => chapter.turnNumber));
  const retrievedCandidates = (input.retrievedSummaries ?? []).filter(
    (entry) => !keptTurnNumbers.has(entry.turnNumber),
  );

  // Candidates arrive pre-ranked by similarity (retrieval.ts) — stop at the
  // first that doesn't fit rather than skipping ahead to a cheaper, less
  // relevant one, so budget pressure trims from the bottom of relevance.
  const retrievedKept: ContextRetrievedSummary[] = [];
  for (const entry of retrievedCandidates) {
    const cost = estimateTokens(renderRetrievedSummary(entry));
    if (cost > remaining) {
      break;
    }
    remaining -= cost;
    retrievedKept.push(entry);
  }

  const retrievedSection =
    retrievedKept.length > 0
      ? `## Relevant History\n${retrievedKept.map(renderRetrievedSummary).join('\n\n')}`
      : null;

  // Recent events and retrieved history sit between world state and the
  // current turn, so the turn being written is nearest the generation point.
  const orderedParts = [
    header,
    canonSection,
    tone,
    entitySection,
    ledgerSection,
    recentSection,
    retrievedSection,
    turnSection,
    constraints,
  ].filter((part): part is string => part !== null);

  const prompt = orderedParts.join('\n\n');

  return {
    prompt,
    estimatedTokens: estimateTokens(prompt),
    droppedChapters,
    droppedRetrievedSummaries: (input.retrievedSummaries ?? []).length - retrievedKept.length,
  };
}
