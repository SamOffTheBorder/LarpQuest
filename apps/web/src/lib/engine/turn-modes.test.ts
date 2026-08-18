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

describe('turn mode dispatch', () => {
  it('resolves the freeform mode', () => {
    const mode = resolveTurnMode('freeform');

    expect(mode.name).toBe('freeform');
    expect(mode.systemPrompt.length).toBeGreaterThan(0);
  });

  it('rejects an unregistered mode by name', () => {
    expect(() => resolveTurnMode('tactical')).toThrow(UnknownTurnModeError);
    expect(() => resolveTurnMode('tactical')).toThrow(/freeform/);
  });

  it('registers exactly one mode in Phase 1', () => {
    expect(registeredTurnModes()).toEqual(['freeform']);
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
