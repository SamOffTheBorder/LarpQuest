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

/** Story-level policy inputs a turn mode's prompt may fold in. Multiplayer,
 * Phase 5 — resolved through fixed lookups keyed by value, never a branch on
 * genre or universe identity. */
export interface TurnModeStoryContext {
  contentRating: string;
  conflictPolicy: string;
  /** Gatekeeper rulings for this turn's proposals, pre-formatted as prose
   * lines. Empty when no submission this turn carried a proposal — see the
   * gatekeeper capability. Never a branch on genre or universe; this is
   * per-turn data, not a policy-value lookup like the other two fields. */
  gatekeeperRulings?: string[];
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

/** Shared by every mode's systemPrompt: content-rating/conflict-policy
 * instructions plus, when present, the Gatekeeper rulings section. Mode
 * prompts differ only in the lines that precede this common tail. */
function policyAndRulingLines(story: TurnModeStoryContext): string[] {
  const contentInstruction = CONTENT_RATING_INSTRUCTIONS[story.contentRating] ?? DEFAULT_CONTENT_RATING_INSTRUCTION;
  const conflictInstruction = CONFLICT_POLICY_INSTRUCTIONS[story.conflictPolicy] ?? DEFAULT_CONFLICT_POLICY_INSTRUCTION;

  const lines = [`- ${contentInstruction}`, `- ${conflictInstruction}`];

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
