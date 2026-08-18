import { describe, expect, it } from 'vitest';

import {
  assembleContext,
  ContextBudgetError,
  type AssembleContextInput,
  type ContextEntity,
} from './context';

function baseInput(overrides: Partial<AssembleContextInput> = {}): AssembleContextInput {
  return {
    story: {
      title: 'Test Story',
      toneDirectives: 'Tense and grounded.',
      worldLedger: { unresolved: ['the missing key'] },
    },
    turn: { turnNumber: 4, mode: 'freeform', sceneSetup: 'The hall is empty.' },
    entities: [],
    recentChapters: [],
    submissions: [{ entityName: 'Aya', content: 'Search the desk.' }],
    ...overrides,
  };
}

const activeEntity: ContextEntity = {
  id: 'e1',
  type: 'character',
  name: 'Aya',
  status: 'active',
  data: { description: 'A careful archivist.' },
};

describe('assembleContext', () => {
  it('is deterministic', () => {
    const input = baseInput({ entities: [activeEntity] });

    const first = assembleContext(input);
    const second = assembleContext(input);

    expect(first.prompt).toBe(second.prompt);
    expect(first.estimatedTokens).toBe(second.estimatedTokens);
  });

  it('does not mutate its inputs', () => {
    const input = baseInput({ entities: [activeEntity] });
    const snapshot = structuredClone(input);

    assembleContext(input);

    expect(input).toEqual(snapshot);
  });

  it('includes active entities and excludes inactive ones', () => {
    const { prompt } = assembleContext(
      baseInput({
        entities: [
          activeEntity,
          { ...activeEntity, id: 'e2', name: 'Rell', status: 'inactive' },
        ],
      }),
    );

    expect(prompt).toContain('Aya');
    expect(prompt).not.toContain('Rell');
  });

  it('includes the world ledger, scene setup, and submissions', () => {
    const { prompt } = assembleContext(baseInput());

    expect(prompt).toContain('the missing key');
    expect(prompt).toContain('The hall is empty.');
    expect(prompt).toContain('Search the desk.');
  });

  it('trims to the configured recent-chapter count, keeping the newest', () => {
    const { prompt } = assembleContext(
      baseInput({
        recentChapters: [
          { turnNumber: 1, prose: 'FIRST' },
          { turnNumber: 2, prose: 'SECOND' },
          { turnNumber: 3, prose: 'THIRD' },
          { turnNumber: 4, prose: 'FOURTH' },
        ],
        policy: { recentChapters: 2, tokenBudget: 24_000 },
      }),
    );

    expect(prompt).not.toContain('SECOND');
    expect(prompt).toContain('THIRD');
    expect(prompt).toContain('FOURTH');
  });

  it('handles fewer chapters existing than requested', () => {
    const result = assembleContext(
      baseInput({
        recentChapters: [{ turnNumber: 1, prose: 'ONLY' }],
        policy: { recentChapters: 5, tokenBudget: 24_000 },
      }),
    );

    expect(result.prompt).toContain('ONLY');
    expect(result.droppedChapters).toBe(0);
  });

  it('drops the oldest chapters first when over budget', () => {
    const long = 'x'.repeat(4_000); // ~1000 tokens each

    const result = assembleContext(
      baseInput({
        recentChapters: [
          { turnNumber: 1, prose: `OLDEST ${long}` },
          { turnNumber: 2, prose: `NEWEST ${long}` },
        ],
        policy: { recentChapters: 3, tokenBudget: 1_400 },
      }),
    );

    expect(result.prompt).toContain('NEWEST');
    expect(result.prompt).not.toContain('OLDEST');
    expect(result.droppedChapters).toBe(1);
  });

  it('never emits a partial chapter', () => {
    const long = 'x'.repeat(40_000);

    const result = assembleContext(
      baseInput({
        recentChapters: [{ turnNumber: 1, prose: long }],
        policy: { recentChapters: 3, tokenBudget: 2_000 },
      }),
    );

    // Dropped whole rather than truncated.
    expect(result.prompt).not.toContain('xxxx');
    expect(result.droppedChapters).toBe(1);
  });

  it('throws when required content alone exceeds the budget', () => {
    const bulky: ContextEntity = {
      ...activeEntity,
      data: { notes: 'y'.repeat(20_000) },
    };

    expect(() => {
      assembleContext(baseInput({ entities: [bulky], policy: { recentChapters: 3, tokenBudget: 500 } }));
    }).toThrow(ContextBudgetError);
  });

  it('serializes unknown entity fields without interpreting them', () => {
    // The engine must never branch on field names. Two structurally different
    // universes — one with powers, one with only knowledge and social state —
    // must both round-trip through the same code path.
    const shonen: ContextEntity = {
      id: 'a',
      type: 'character',
      name: 'Kaito',
      status: 'active',
      data: { abilities: ['Hollow Purple'], power_tier: 'Special Grade' },
    };

    const mystery: ContextEntity = {
      id: 'b',
      type: 'character',
      name: 'Inspector Vale',
      status: 'active',
      data: { knows: ['the alibi is false'], suspicion_level: 3 },
    };

    const { prompt } = assembleContext(baseInput({ entities: [shonen, mystery] }));

    expect(prompt).toContain('Hollow Purple');
    expect(prompt).toContain('Special Grade');
    expect(prompt).toContain('the alibi is false');
    expect(prompt).toContain('suspicion_level');
  });

  it('reports no active entities without failing', () => {
    const { prompt } = assembleContext(baseInput({ entities: [] }));
    expect(prompt).toContain('(no active entities)');
  });
});
