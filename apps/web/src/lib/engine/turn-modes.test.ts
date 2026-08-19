import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TURN_MODE,
  UnknownTurnModeError,
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
