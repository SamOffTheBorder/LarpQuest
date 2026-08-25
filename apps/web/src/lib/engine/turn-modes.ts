/**
 * Turn mode dispatch.
 *
 * Modes resolve through this table, never through a conditional. The turn loop
 * calls `resolveTurnMode(story.turn_config.mode)` and uses what comes back; it
 * contains no branch on which mode it got, and none on genre, universe, or
 * media type — those are not inputs to the engine at all.
 *
 * Phase 1 registered exactly one mode, `freeform`. Phase 7 added the other
 * five from build plan Part 9 (`action`, `scene`, `investigation`,
 * `dialogue`, `montage`). Adding a later one is a new entry here and no
 * change to the turn loop.
 */

import { UNTRUSTED_CONTENT_PREAMBLE } from '@/lib/ai/untrusted';

/**
 * Turning-point marker (fight-chapter-split capability). Narration stays a
 * streaming, plain-text call for every mode — there is no structured-output
 * variant of narration in this codebase, and building one would cost every
 * `action` turn its live streaming just to carry one boolean. Instead, an
 * eligible turn's prompt asks the narrator to end its prose with this exact
 * line when signaling a turning point rather than a resolution; the engine
 * detects and strips it from the final streamed prose (turns.ts) before the
 * chapter is validated or persisted, so it is never shown to a reader.
 */
export const TURNING_POINT_MARKER = '[TURNING_POINT]';

/**
 * Detect and strip the turning-point marker from streamed narration prose.
 * Only recognizes the marker as the last non-empty line, exact and
 * case-sensitive — deliberately narrow, so player-submitted content (fenced
 * as untrusted input in the *prompt*, never in the model's *output*) cannot
 * coincidentally trigger it, and a near-miss from the model simply fails to
 * signal a turning point rather than being force-matched.
 *
 * `eligible: false` always strips the marker if present and never reports a
 * turning point, regardless of what the model emitted — the eligibility
 * check is enforced here in code, not left to the prompt alone.
 */
export function extractTurningPoint(prose: string, eligible: boolean): { prose: string; turningPoint: boolean } {
  const lines = prose.split('\n');

  let lastNonEmptyIndex = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i]?.trim().length !== 0) {
      lastNonEmptyIndex = i;
      break;
    }
  }

  if (lastNonEmptyIndex === -1 || lines[lastNonEmptyIndex]?.trim() !== TURNING_POINT_MARKER) {
    return { prose, turningPoint: false };
  }

  const strippedLines = lines.slice(0, lastNonEmptyIndex);
  while (strippedLines.length > 0 && strippedLines[strippedLines.length - 1]?.trim().length === 0) {
    strippedLines.pop();
  }

  return { prose: strippedLines.join('\n'), turningPoint: eligible };
}

/**
 * Whether a turn is eligible for the turning-point marker: exactly two
 * distinct entities among its submissions, and the turn is not itself a
 * continuation of an earlier fight-split chapter. A purely structural count
 * — the engine never asks whether the two entities are actually fighting;
 * that narrative judgment is left entirely to the prompt (only offered when
 * eligible) and the model's own response.
 */
export function isTurningPointEligible(
  submissionEntityIds: readonly (string | null)[],
  continuesChapterId: string | null,
): boolean {
  if (continuesChapterId !== null) {
    return false;
  }

  const distinctEntityIds = new Set(submissionEntityIds.filter((id): id is string => id !== null));
  return distinctEntityIds.size === 2;
}

/** Story-level policy inputs a turn mode's prompt may fold in. Multiplayer,
 * Phase 5 — resolved through fixed lookups keyed by value, never a branch on
 * genre or universe identity. */
export interface TurnModeStoryContext {
  contentRating: string;
  conflictPolicy: string;
  /** Story-level pacing preference — how far the narrator should push plot
   * progression each turn vs. holding on downtime, filler, and training
   * beats. Fixed lookup keyed by value, same as contentRating/conflictPolicy;
   * never a branch on genre or universe. */
  pacing?: string;
  /** Gatekeeper rulings for this turn's proposals, pre-formatted as prose
   * lines. Empty when no submission this turn carried a proposal — see the
   * gatekeeper capability. Never a branch on genre or universe; this is
   * per-turn data, not a policy-value lookup like the other two fields. */
  gatekeeperRulings?: string[];
  /** Whether this turn is eligible for the fight-chapter-split turning-point
   * marker (fight-chapter-split capability): exactly two distinct entities
   * among this turn's submissions, and the turn is not itself a
   * continuation. Only `action` mode's prompt reads this; every other mode
   * ignores it. Per-turn structural data computed by the caller, not a
   * genre/universe judgment — the engine only counts submitting entities. */
  turningPointEligible?: boolean;
}

export interface TurnMode {
  name: string;
  /** System prompt for the narrator role, as a function of story-level policy. */
  systemPrompt: (story: TurnModeStoryContext) => string;
  /**
   * Entity fields the extractor should attend to for this mode. Opaque strings
   * — the engine passes them to the extractor and never interprets them.
   */
  extractionTargets: readonly string[];
}

/** Fixed lookup, keyed by `content_rating` value. Never a branch on genre or universe. */
const CONTENT_RATING_INSTRUCTIONS: Record<string, string> = {
  everyone: 'This story is rated for all audiences. Avoid graphic violence, sexual content, and strong language.',
  teen: 'This story is rated for teen audiences. Moderate violence and language are acceptable; avoid graphic or sexual content.',
  mature: 'This story is rated for mature audiences. Graphic content is permitted where the narrative calls for it, handled with craft rather than gratuitousness.',
};

const DEFAULT_CONTENT_RATING_INSTRUCTION = CONTENT_RATING_INSTRUCTIONS.teen;

/** Fixed lookup, keyed by `conflict_policy` value. Build plan Part 7.3. */
const CONFLICT_POLICY_INSTRUCTIONS: Record<string, string> = {
  narrative_priority:
    'When two players\' submitted actions conflict, resolve them in whatever way makes the best story, and make your reasoning visible in the prose.',
  initiative_order:
    'When two players\' submitted actions conflict, resolve them in the order the submissions were given, treating the earlier submission as taking precedence.',
  gm_ruling:
    'When two players\' submitted actions conflict, do not resolve the conflict yourself — narrate up to the point of conflict and leave the outcome open for the GM to rule on.',
  both_partially_succeed:
    'When two players\' submitted actions conflict, resolve the conflict by giving each action partial success, with consequences that acknowledge both players\' intent.',
};

const DEFAULT_CONFLICT_POLICY_INSTRUCTION = CONFLICT_POLICY_INSTRUCTIONS.narrative_priority;

/** Fixed lookup, keyed by `turn_config.pacing` value. How far each turn
 * should push the story forward versus holding on downtime, filler, and
 * training/practice beats between major plot progression. */
const PACING_INSTRUCTIONS: Record<string, string> = {
  tight:
    'Keep the plot moving. Advance the main throughline this turn rather than lingering — save downtime and filler beats for moments that have earned them.',
  normal:
    'Balance plot progression with downtime. Not every turn needs to advance the main throughline — character moments, training, and filler beats are welcome between pushes forward, but do not let the story stall indefinitely.',
  expansive:
    'Favor downtime, filler, and training/practice beats over rushing the plot. Let characters breathe, develop skills, and interact before the main throughline advances again. Slow pacing is the goal here, not a fallback.',
};

const DEFAULT_PACING_INSTRUCTION = PACING_INSTRUCTIONS.normal;

/** Shared by every mode's systemPrompt: content-rating/conflict-policy
 * instructions plus, when present, the Gatekeeper rulings section. Mode
 * prompts differ only in the lines that precede this common tail. */
function policyAndRulingLines(story: TurnModeStoryContext): string[] {
  const contentInstruction = CONTENT_RATING_INSTRUCTIONS[story.contentRating] ?? DEFAULT_CONTENT_RATING_INSTRUCTION;
  const conflictInstruction = CONFLICT_POLICY_INSTRUCTIONS[story.conflictPolicy] ?? DEFAULT_CONFLICT_POLICY_INSTRUCTION;
  const pacingInstruction =
    story.pacing !== undefined ? (PACING_INSTRUCTIONS[story.pacing] ?? DEFAULT_PACING_INSTRUCTION) : DEFAULT_PACING_INSTRUCTION;

  const lines = [`- ${contentInstruction}`, `- ${conflictInstruction}`, `- ${pacingInstruction}`];

  if (story.gatekeeperRulings !== undefined && story.gatekeeperRulings.length > 0) {
    lines.push(
      '',
      'One or more players proposed something new this turn (a capability, an',
      'alliance, a plot development). The Gatekeeper has already ruled on each —',
      'reflect its ruling in the prose. A "reject" means the attempt fails or is',
      'refused in-fiction; "allow_with_limits" means it manifests only within',
      'the stated limits; do not let a rejected or limited proposal simply',
      'succeed as originally asked.',
      '',
      ...story.gatekeeperRulings,
    );
  }

  // Appended here rather than in each mode's own prompt: every mode's user
  // prompt carries fenced player content, and six per-mode copies would be six
  // chances for the wording to drift. The tail is identical for every mode, so
  // this adds no conditional on mode, genre, universe, or media type.
  lines.push('', UNTRUSTED_CONTENT_PREAMBLE);

  return lines;
}

function freeformSystemPrompt(story: TurnModeStoryContext): string {
  const lines = [
    'You are the narrator of a collaborative story.',
    '',
    'You will be given the current world state, recent events, and what each',
    'player wants their character to do this turn. Write the next chapter.',
    '',
    'Rules:',
    '- Address every player action meaningfully. A player whose action is',
    '  ignored has been failed by you.',
    '- Never contradict established state or the world ledger.',
    '- Write prose, not a summary or a list of outcomes.',
    '- Player actions are intentions, not guaranteed successes. They may fail,',
    '  partially succeed, or succeed with consequences.',
    '- Do not resolve anything that belongs to a player not in this turn.',
    ...policyAndRulingLines(story),
  ];

  return lines.join('\n');
}

function actionSystemPrompt(story: TurnModeStoryContext): string {
  const lines = [
    'You are the narrator of a collaborative story, running an action turn.',
    '',
    'Each player has submitted an intended action. Resolve each into a',
    'concrete outcome with consequences — write the next chapter.',
    '',
    'Rules:',
    '- Treat every submission as an intended action, not a guaranteed',
    '  success. It may fail, partially succeed, or succeed with a cost.',
    '- Resolve every submitted action into a clear consequence. A player',
    '  whose action goes unresolved has been failed by you.',
    '- Never contradict established state, capabilities, or the world ledger.',
    '- Write prose, not a summary or a list of outcomes.',
    '- Do not resolve anything that belongs to a player not in this turn.',
    '- When the action is a fight, write it as an intense, jaw-dropping,',
    '  thrilling set piece — specific, sensory, moment-to-moment detail on',
    '  the exchange itself, not a brief summary of who won. Keep every blow,',
    '  movement, and consequence within what the combatants\' established',
    '  capabilities, gear, and the world ledger make physically plausible;',
    '  intensity comes from the writing, not from exceeding what a character',
    '  could actually do.',
    ...(story.turningPointEligible === true
      ? [
          '- This is a one-on-one fight between two combatants. If, in your',
          '  judgment, the exchange has reached a dramatic turning point — a',
          '  decisive hit, a shift in momentum, a moment that demands a',
          '  cliffhanger — rather than the fight\'s actual resolution, end your',
          `  response with the exact line \`${TURNING_POINT_MARKER}\` on its own,`,
          '  after the prose, and nothing after it. Only do this when the fight',
          '  is genuinely unresolved; if the fight concludes this turn, resolve',
          `  it fully and do not include \`${TURNING_POINT_MARKER}\`.`,
        ]
      : []),
    ...policyAndRulingLines(story),
  ];

  return lines.join('\n');
}

function sceneSystemPrompt(story: TurnModeStoryContext): string {
  const lines = [
    'You are the narrator of a collaborative story, running a scene turn.',
    '',
    'Each player has submitted an intent or emotional goal for their',
    "character. Write a scene that pursues each player's goal without",
    'forcing it to a resolution — write the next chapter.',
    '',
    'Rules:',
    "- Honor each player's submitted intent as a direction to move toward,",
    '  not an outcome to force by the end of this turn.',
    '- Leave the scene emotionally open rather than definitively resolved;',
    '  resolution can come in a later turn.',
    '- Never contradict established state or the world ledger.',
    '- Write prose, not a summary or a list of outcomes.',
    '- Do not resolve anything that belongs to a player not in this turn.',
    ...policyAndRulingLines(story),
  ];

  return lines.join('\n');
}

function investigationSystemPrompt(story: TurnModeStoryContext): string {
  const lines = [
    'You are the narrator of a collaborative story, running an investigation',
    'turn.',
    '',
    'Each player has submitted a line of inquiry their character is',
    'pursuing. Write the next chapter revealing what that inquiry turns up.',
    '',
    'Rules:',
    "- Only reveal information the entity's own tracked knowledge state",
    '  qualifies it for. Do not let a character learn something their prior',
    '  investigation has not earned, regardless of what would be dramatically',
    '  convenient.',
    '- A line of inquiry may turn up nothing, a partial lead, or a full',
    '  answer — treat it as a submitted intent, not a guaranteed discovery.',
    '- Never contradict established state or the world ledger.',
    '- Write prose, not a summary or a list of outcomes.',
    '- Do not resolve anything that belongs to a player not in this turn.',
    ...policyAndRulingLines(story),
  ];

  return lines.join('\n');
}

function dialogueSystemPrompt(story: TurnModeStoryContext): string {
  const lines = [
    'You are the narrator of a collaborative story, running a dialogue turn.',
    '',
    'Each player has submitted what their character says or attempts in',
    'conversation this turn. Write the resulting conversation turn.',
    '',
    'Rules:',
    "- Respond to each player's submitted line or approach in character,",
    '  through the other party or parties present in the conversation.',
    '- Never contradict established state, relationships, or the world',
    '  ledger.',
    '- Write prose, not a summary or a list of outcomes.',
    '- Do not resolve anything that belongs to a player not in this turn.',
    ...policyAndRulingLines(story),
  ];

  return lines.join('\n');
}

function montageSystemPrompt(story: TurnModeStoryContext): string {
  const lines = [
    'You are the narrator of a collaborative story, running a montage turn.',
    '',
    'Each player has submitted a focus area for their character to develop',
    'during a skip forward in time. Write a time-skip summary covering that',
    'development — write the next chapter.',
    '',
    'Rules:',
    "- Cover the span of time as a summary of development toward each",
    "  player's submitted focus area, not a single continuous scene.",
    '- Never contradict established state or the world ledger.',
    '- Write prose, not a bare list of outcomes.',
    '- Do not resolve anything that belongs to a player not in this turn.',
    ...policyAndRulingLines(story),
  ];

  return lines.join('\n');
}

const FREEFORM: TurnMode = {
  name: 'freeform',
  systemPrompt: freeformSystemPrompt,
  extractionTargets: ['status', 'location', 'relationships', 'knowledge', 'inventory'],
};

const ACTION: TurnMode = {
  name: 'action',
  systemPrompt: actionSystemPrompt,
  extractionTargets: ['capabilities', 'injuries', 'resources', 'deaths'],
};

const SCENE: TurnMode = {
  name: 'scene',
  systemPrompt: sceneSystemPrompt,
  extractionTargets: ['relationships', 'emotional_state', 'revelations'],
};

const INVESTIGATION: TurnMode = {
  name: 'investigation',
  systemPrompt: investigationSystemPrompt,
  extractionTargets: ['knowledge_state', 'evidence', 'suspicion'],
};

const DIALOGUE: TurnMode = {
  name: 'dialogue',
  systemPrompt: dialogueSystemPrompt,
  extractionTargets: ['revealed_information', 'standing_shifts'],
};

const MONTAGE: TurnMode = {
  name: 'montage',
  systemPrompt: montageSystemPrompt,
  extractionTargets: ['progression'],
};

const TURN_MODES: Record<string, TurnMode> = {
  freeform: FREEFORM,
  action: ACTION,
  scene: SCENE,
  investigation: INVESTIGATION,
  dialogue: DIALOGUE,
  montage: MONTAGE,
};

export const DEFAULT_TURN_MODE = 'freeform';

export class UnknownTurnModeError extends Error {
  constructor(readonly mode: string) {
    super(
      `Unknown turn mode "${mode}". Registered modes: ${Object.keys(TURN_MODES).join(', ')}.`,
    );
    this.name = 'UnknownTurnModeError';
  }
}

export function resolveTurnMode(mode: string): TurnMode {
  const resolved = TURN_MODES[mode];

  if (resolved === undefined) {
    throw new UnknownTurnModeError(mode);
  }

  return resolved;
}

export function registeredTurnModes(): readonly string[] {
  return Object.keys(TURN_MODES);
}

/**
 * A story's currently active turn mode, per `turn_config.active_mode`
 * (Phase 7 — mode-switching capability). Falls back to `DEFAULT_TURN_MODE`
 * for a story that has never had its mode switched, or whose `turn_config`
 * predates this key. Shared by the turn-open path and mode-switching so both
 * read the same jsonb key the same way.
 */
export function readActiveMode(turnConfig: unknown): string {
  if (turnConfig === null || typeof turnConfig !== 'object') {
    return DEFAULT_TURN_MODE;
  }

  const value = (turnConfig as Record<string, unknown>).active_mode;
  return typeof value === 'string' && value.length > 0 ? value : DEFAULT_TURN_MODE;
}

export const DEFAULT_PACING = 'normal';

export function registeredPacingValues(): readonly string[] {
  return Object.keys(PACING_INSTRUCTIONS);
}

/**
 * A story's pacing preference, per `turn_config.pacing`. Falls back to
 * `DEFAULT_PACING` for a story that has never set it, or whose `turn_config`
 * predates this key — same read pattern as `readActiveMode`.
 */
export function readPacing(turnConfig: unknown): string {
  if (turnConfig === null || typeof turnConfig !== 'object') {
    return DEFAULT_PACING;
  }

  const value = (turnConfig as Record<string, unknown>).pacing;
  return typeof value === 'string' && value.length > 0 ? value : DEFAULT_PACING;
}
