/**
 * Context assembly — the most important function in the codebase.
 *
 * `assembleContext` is a PURE function of its persisted inputs. It performs no
 * writes and its output is never stored: a stored context goes stale
 * immediately, and stale context is exactly the drift the architecture exists
 * to prevent.
 *
 * Phase 1 does no retrieval and no canon compression. The signature is the one
 * Phase 4 will keep, so adding embeddings and retrieval never touches a caller.
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
}

export interface ContextTurn {
  turnNumber: number;
  mode: string;
  sceneSetup: string | null;
}

export interface AssembleContextInput {
  story: ContextStory;
  turn: ContextTurn;
  entities: readonly ContextEntity[];
  /** Most recent last. Trimmed to `recentChapterCount` and to fit the budget. */
  recentChapters: readonly ContextChapter[];
  submissions: readonly ContextSubmission[];
  policy?: ContextPolicy;
}

export interface ContextPolicy {
  recentChapters: number;
  tokenBudget: number;
}

export const DEFAULT_CONTEXT_POLICY: ContextPolicy = {
  recentChapters: 3,
  tokenBudget: 24_000,
};

export interface AssembledContext {
  prompt: string;
  estimatedTokens: number;
  /** Chapters omitted to fit the budget. Surfaced so the drop is visible. */
  droppedChapters: number;
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

  const requiredParts = [header, tone, entitySection, ledgerSection, turnSection, constraints].filter(
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

  // Recent events sit between world state and the current turn, so the turn
  // being written is nearest the generation point.
  const orderedParts = [
    header,
    tone,
    entitySection,
    ledgerSection,
    recentSection,
    turnSection,
    constraints,
  ].filter((part): part is string => part !== null);

  const prompt = orderedParts.join('\n\n');

  return {
    prompt,
    estimatedTokens: estimateTokens(prompt),
    droppedChapters,
  };
}
