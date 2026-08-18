import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROGRESSION_MODEL,
  UnknownProgressionModelError,
  registeredProgressionModels,
  resolveProgressionModel,
} from '@/lib/engine/progression-models';

const capabilityField = { type: 'capability_list' };
const resourceField = { type: 'resource' };

describe('progression model dispatch', () => {
  it('resolves both Phase 2 models', () => {
    expect([...registeredProgressionModels()].sort()).toEqual(['ability_unlock', 'none']);
  });

  it('rejects an unregistered model by name', () => {
    expect(() => resolveProgressionModel('numeric_scaling')).toThrow(
      UnknownProgressionModelError,
    );
    expect(() => resolveProgressionModel('numeric_scaling')).toThrow(/ability_unlock/);
  });

  it('defaults to a registered model', () => {
    expect(() => resolveProgressionModel(DEFAULT_PROGRESSION_MODEL)).not.toThrow();
  });
});

describe('none progression model', () => {
  it('allows an arbitrary transition', () => {
    const model = resolveProgressionModel('none');

    expect(model.validateTransition).toBeUndefined();
  });
});

describe('ability_unlock progression model', () => {
  const model = resolveProgressionModel('ability_unlock');

  it('accepts a valid transition sequence', () => {
    expect(model.validateTransition!(capabilityField, 'proposed', 'developing')).toBe(true);
    expect(model.validateTransition!(capabilityField, 'developing', 'available')).toBe(true);
    expect(model.validateTransition!(capabilityField, 'available', 'mastered')).toBe(true);
    expect(model.validateTransition!(capabilityField, 'available', 'lost')).toBe(true);
    expect(model.validateTransition!(capabilityField, 'available', 'sealed')).toBe(true);
  });

  it('rejects skipping an intermediate state', () => {
    expect(model.validateTransition!(capabilityField, 'proposed', 'mastered')).toBe(false);
    expect(model.validateTransition!(capabilityField, 'proposed', 'available')).toBe(false);
  });

  it('rejects any further transition from a terminal state', () => {
    expect(model.validateTransition!(capabilityField, 'mastered', 'available')).toBe(false);
    expect(model.validateTransition!(capabilityField, 'lost', 'developing')).toBe(false);
    expect(model.validateTransition!(capabilityField, 'sealed', 'proposed')).toBe(false);
  });

  it('passes through fields that are not capability_list unchecked', () => {
    expect(model.validateTransition!(resourceField, 'anything', 'anything-else')).toBe(true);
  });
});
