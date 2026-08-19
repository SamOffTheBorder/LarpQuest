/**
 * Turn mode dispatch.
 *
 * Modes resolve through this table, never through a conditional. The turn loop
 * calls `resolveTurnMode(story.turn_config.mode)` and uses what comes back; it
 * contains no branch on which mode it got, and none on genre, universe, or
 * media type — those are not inputs to the engine at all.
 *
 * Phase 1 registers exactly one mode. Adding a later one is a new entry here
 * and no change to the turn loop.
 */

/** Story-level policy inputs a turn mode's prompt may fold in. Multiplayer,
 * Phase 5 — resolved through fixed lookups keyed by value, never a branch on
 * genre or universe identity. */
export interface TurnModeStoryContext {
  contentRating: string;
  conflictPolicy: string;
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

function freeformSystemPrompt(story: TurnModeStoryContext): string {
  const contentInstruction = CONTENT_RATING_INSTRUCTIONS[story.contentRating] ?? DEFAULT_CONTENT_RATING_INSTRUCTION;
  const conflictInstruction = CONFLICT_POLICY_INSTRUCTIONS[story.conflictPolicy] ?? DEFAULT_CONFLICT_POLICY_INSTRUCTION;

  return [
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
    `- ${contentInstruction}`,
    `- ${conflictInstruction}`,
  ].join('\n');
}

const FREEFORM: TurnMode = {
  name: 'freeform',
  systemPrompt: freeformSystemPrompt,
  extractionTargets: ['status', 'location', 'relationships', 'knowledge', 'inventory'],
};

const TURN_MODES: Record<string, TurnMode> = {
  freeform: FREEFORM,
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
