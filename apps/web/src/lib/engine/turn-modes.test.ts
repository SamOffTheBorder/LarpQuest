import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PACING,
  DEFAULT_TURN_MODE,
  TURNING_POINT_MARKER,
  UnknownTurnModeError,
  extractTurningPoint,
  isTurningPointEligible,
  readPacing,
  registeredPacingValues,
  registeredTurnModes,
  resolveTurnMode,
} from '@/lib/engine/turn-modes';

/**
 * The dispatch table is the structure that keeps genre out of the engine.
 * These tests guard the property, not the current contents.
 */

const DEFAULT_STORY_CONTEXT = { contentRating: 'teen', conflictPolicy: 'narrative_priority' };

describe('turn mode dispatch', () => {
  it('resolves the freeform mode', () => {
    const mode = resolveTurnMode('freeform');

    expect(mode.name).toBe('freeform');
    expect(mode.systemPrompt(DEFAULT_STORY_CONTEXT).length).toBeGreaterThan(0);
  });

  it('rejects an unregistered mode by name', () => {
    expect(() => resolveTurnMode('tactical')).toThrow(UnknownTurnModeError);
    expect(() => resolveTurnMode('tactical')).toThrow(/freeform/);
  });

  it('registers all six modes after Phase 7', () => {
    expect([...registeredTurnModes()].sort()).toEqual(
      ['action', 'dialogue', 'freeform', 'investigation', 'montage', 'scene'].sort(),
    );
  });

  it('defaults to a registered mode', () => {
    expect(() => resolveTurnMode(DEFAULT_TURN_MODE)).not.toThrow();
  });

  it('carries extraction targets without the engine interpreting them', () => {
    const mode = resolveTurnMode('freeform');

    // Opaque strings passed through to the extractor. The engine must never
    // branch on their contents, so the only contract is that they exist.
    expect(mode.extractionTargets.length).toBeGreaterThan(0);
    expect(mode.extractionTargets.every((target) => typeof target === 'string')).toBe(true);
  });
});

describe('content rating and conflict policy prompt wiring', () => {
  const mode = resolveTurnMode('freeform');

  it('each content_rating value produces distinct prompt text', () => {
    const everyone = mode.systemPrompt({ contentRating: 'everyone', conflictPolicy: 'narrative_priority' });
    const teen = mode.systemPrompt({ contentRating: 'teen', conflictPolicy: 'narrative_priority' });
    const mature = mode.systemPrompt({ contentRating: 'mature', conflictPolicy: 'narrative_priority' });

    expect(new Set([everyone, teen, mature]).size).toBe(3);
    expect(everyone).toContain('all audiences');
    expect(teen).toContain('teen audiences');
    expect(mature).toContain('mature audiences');
  });

  it('each conflict_policy value produces distinct prompt text', () => {
    const policies = ['narrative_priority', 'initiative_order', 'gm_ruling', 'both_partially_succeed'] as const;
    const prompts = policies.map((conflictPolicy) => mode.systemPrompt({ contentRating: 'teen', conflictPolicy }));

    expect(new Set(prompts).size).toBe(4);
  });

  it('two different universes with the same policy values produce byte-identical instruction text', () => {
    // "Different universes" is represented by nothing more than a different
    // story title / entity set upstream — this function never receives or
    // reads universe/genre identity at all, so the same policy values must
    // always resolve to the same text regardless of what story they came from.
    const a = mode.systemPrompt({ contentRating: 'mature', conflictPolicy: 'gm_ruling' });
    const b = mode.systemPrompt({ contentRating: 'mature', conflictPolicy: 'gm_ruling' });

    expect(a).toBe(b);
  });

  it('an unrecognized content_rating or conflict_policy value falls back rather than throwing', () => {
    expect(() =>
      mode.systemPrompt({ contentRating: 'unknown-rating', conflictPolicy: 'unknown-policy' }),
    ).not.toThrow();
  });
});

describe('pacing prompt wiring', () => {
  const mode = resolveTurnMode('freeform');

  it('each pacing value produces distinct prompt text', () => {
    const tight = mode.systemPrompt({ ...DEFAULT_STORY_CONTEXT, pacing: 'tight' });
    const normal = mode.systemPrompt({ ...DEFAULT_STORY_CONTEXT, pacing: 'normal' });
    const expansive = mode.systemPrompt({ ...DEFAULT_STORY_CONTEXT, pacing: 'expansive' });

    expect(new Set([tight, normal, expansive]).size).toBe(3);
    expect(tight).toMatch(/keep the plot moving/i);
    expect(normal).toMatch(/balance plot progression with downtime/i);
    expect(expansive).toMatch(/favor downtime, filler, and training/i);
  });

  it('omitted pacing falls back to the same text as the default value', () => {
    const omitted = mode.systemPrompt(DEFAULT_STORY_CONTEXT);
    const explicitDefault = mode.systemPrompt({ ...DEFAULT_STORY_CONTEXT, pacing: DEFAULT_PACING });

    expect(omitted).toBe(explicitDefault);
  });

  it('an unrecognized pacing value falls back rather than throwing', () => {
    expect(() => mode.systemPrompt({ ...DEFAULT_STORY_CONTEXT, pacing: 'breakneck' })).not.toThrow();
  });

  it('registers the three pacing values', () => {
    expect([...registeredPacingValues()].sort()).toEqual(['expansive', 'normal', 'tight']);
  });

  it('readPacing falls back to the default for missing or malformed turn_config', () => {
    expect(readPacing(null)).toBe(DEFAULT_PACING);
    expect(readPacing({})).toBe(DEFAULT_PACING);
    expect(readPacing({ pacing: 'tight' })).toBe('tight');
  });
});

describe('gatekeeper ruling prompt wiring', () => {
  const mode = resolveTurnMode(DEFAULT_TURN_MODE);

  it('omits the ruling section when there are no rulings this turn', () => {
    const withoutRulings = mode.systemPrompt(DEFAULT_STORY_CONTEXT);
    const withEmptyArray = mode.systemPrompt({ ...DEFAULT_STORY_CONTEXT, gatekeeperRulings: [] });

    expect(withoutRulings).toBe(withEmptyArray);
    expect(withoutRulings).not.toMatch(/Gatekeeper/i);
  });

  it('includes every ruling line when proposals were evaluated this turn', () => {
    const prompt = mode.systemPrompt({
      ...DEFAULT_STORY_CONTEXT,
      gatekeeperRulings: ['- Yuji proposed: "Domain Expansion" — verdict: reject. No established basis.'],
    });

    expect(prompt).toMatch(/Gatekeeper/i);
    expect(prompt).toContain('Yuji proposed: "Domain Expansion"');
  });
});

describe('isTurningPointEligible', () => {
  it('is eligible for exactly two distinct entities and no continuation', () => {
    expect(isTurningPointEligible(['a', 'b'], null)).toBe(true);
    expect(isTurningPointEligible(['a', 'b', 'a'], null)).toBe(true);
  });

  it('is ineligible for one entity', () => {
    expect(isTurningPointEligible(['a'], null)).toBe(false);
    expect(isTurningPointEligible(['a', 'a'], null)).toBe(false);
  });

  it('is ineligible for three or more distinct entities', () => {
    expect(isTurningPointEligible(['a', 'b', 'c'], null)).toBe(false);
  });

  it('is ineligible when the turn is itself a continuation', () => {
    expect(isTurningPointEligible(['a', 'b'], 'chapter-1')).toBe(false);
  });

  it('ignores null entity ids when counting', () => {
    expect(isTurningPointEligible(['a', 'b', null], null)).toBe(true);
    expect(isTurningPointEligible([null, null], null)).toBe(false);
  });
});

describe('extractTurningPoint', () => {
  it('detects and strips a trailing marker when eligible', () => {
    const result = extractTurningPoint(`They clash blades in the rain.\n\n${TURNING_POINT_MARKER}`, true);

    expect(result.turningPoint).toBe(true);
    expect(result.prose).toBe('They clash blades in the rain.');
    expect(result.prose).not.toContain(TURNING_POINT_MARKER);
  });

  it('strips the marker but reports no turning point when ineligible', () => {
    const result = extractTurningPoint(`The battle rages on.\n${TURNING_POINT_MARKER}`, false);

    expect(result.turningPoint).toBe(false);
    expect(result.prose).toBe('The battle rages on.');
  });

  it('leaves prose untouched when no marker is present', () => {
    const result = extractTurningPoint('The fight ends with a decisive blow.', true);

    expect(result.turningPoint).toBe(false);
    expect(result.prose).toBe('The fight ends with a decisive blow.');
  });

  it('does not match the marker embedded mid-sentence', () => {
    const prose = `She shouted ${TURNING_POINT_MARKER} but it meant nothing here.`;
    const result = extractTurningPoint(prose, true);

    expect(result.turningPoint).toBe(false);
    expect(result.prose).toBe(prose);
  });

  it('does not match a near-miss of the marker text', () => {
    const result = extractTurningPoint('The fight continues.\n[turning_point]', true);

    expect(result.turningPoint).toBe(false);
    expect(result.prose).toBe('The fight continues.\n[turning_point]');
  });
});

describe('action mode fight-intensity instructions', () => {
  it('instructs intense, detailed fight prose bounded by plausibility', () => {
    const mode = resolveTurnMode('action');
    const prompt = mode.systemPrompt(DEFAULT_STORY_CONTEXT);

    expect(prompt).toMatch(/jaw-dropping/i);
    expect(prompt).toMatch(/thrilling/i);
    expect(prompt).toMatch(/moment-to-moment detail/i);
    expect(prompt).toMatch(/physically plausible/i);
  });
});

describe('action mode turning-point marker prompt wiring', () => {
  it('mentions the marker only when turningPointEligible is true', () => {
    const mode = resolveTurnMode('action');
    const eligible = mode.systemPrompt({ ...DEFAULT_STORY_CONTEXT, turningPointEligible: true });
    const ineligible = mode.systemPrompt({ ...DEFAULT_STORY_CONTEXT, turningPointEligible: false });
    const omitted = mode.systemPrompt(DEFAULT_STORY_CONTEXT);

    expect(eligible).toContain(TURNING_POINT_MARKER);
    expect(ineligible).not.toContain(TURNING_POINT_MARKER);
    expect(omitted).not.toContain(TURNING_POINT_MARKER);
  });

  it('other modes never mention the marker regardless of the flag', () => {
    const modes = registeredTurnModes().filter((name) => name !== 'action');

    for (const name of modes) {
      const mode = resolveTurnMode(name);
      const prompt = mode.systemPrompt({ ...DEFAULT_STORY_CONTEXT, turningPointEligible: true });
      expect(prompt).not.toContain(TURNING_POINT_MARKER);
    }
  });
});

describe('Phase 7 turn modes', () => {
  const newModeNames = ['action', 'scene', 'investigation', 'dialogue', 'montage'] as const;

  it.each(newModeNames)('%s mode has a non-empty prompt and extraction targets', (name) => {
    const mode = resolveTurnMode(name);

    expect(mode.name).toBe(name);
    expect(mode.systemPrompt(DEFAULT_STORY_CONTEXT).length).toBeGreaterThan(0);
    expect(mode.extractionTargets.length).toBeGreaterThan(0);
    expect(mode.extractionTargets.every((target) => typeof target === 'string')).toBe(true);
  });

  it.each(newModeNames)('%s mode still injects content-rating and conflict-policy instructions', (name) => {
    const mode = resolveTurnMode(name);
    const everyone = mode.systemPrompt({ contentRating: 'everyone', conflictPolicy: 'gm_ruling' });

    expect(everyone).toContain('all audiences');
    expect(everyone).toMatch(/do not resolve the conflict yourself/i);
  });

  it.each(newModeNames)('%s mode still appends the Gatekeeper rulings section when present', (name) => {
    const mode = resolveTurnMode(name);
    const withoutRulings = mode.systemPrompt(DEFAULT_STORY_CONTEXT);
    const withRulings = mode.systemPrompt({
      ...DEFAULT_STORY_CONTEXT,
      gatekeeperRulings: ['- A player proposed something — verdict: allow_with_limits.'],
    });

    expect(withoutRulings).not.toMatch(/Gatekeeper/i);
    expect(withRulings).toMatch(/Gatekeeper/i);
    expect(withRulings).toContain('verdict: allow_with_limits');
  });

  it('each of the six modes produces distinct prompt text for the same story context', () => {
    const allModes = registeredTurnModes();
    const prompts = allModes.map((name) => resolveTurnMode(name).systemPrompt(DEFAULT_STORY_CONTEXT));

    expect(new Set(prompts).size).toBe(allModes.length);
  });

  it('investigation mode instructs gating by tracked knowledge state, independent of any specific universe schema', () => {
    const mode = resolveTurnMode('investigation');
    const prompt = mode.systemPrompt(DEFAULT_STORY_CONTEXT);

    // Prompt-text assertion only — the engine does not validate that any
    // particular universe schema defines a knowledge-state field. A universe
    // without one simply makes the instruction inert, per design.md Decision 5.
    expect(prompt).toMatch(/knowledge state/i);
    expect(prompt).not.toMatch(/clue|mystery|detective|magic|power/i);
  });
});
