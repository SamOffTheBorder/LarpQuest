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

export interface TurnMode {
  name: string;
  /** System prompt for the narrator role. */
  systemPrompt: string;
  /**
   * Entity fields the extractor should attend to for this mode. Opaque strings
   * — the engine passes them to the extractor and never interprets them.
   */
  extractionTargets: readonly string[];
}

const FREEFORM: TurnMode = {
  name: 'freeform',
  systemPrompt: [
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
  ].join('\n'),
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
