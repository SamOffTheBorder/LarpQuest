import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MODELS,
  MODEL_ROLES,
  defaultModelConfig,
  modelConfigSchema,
  resolveModel,
} from './roles';

describe('model role resolution', () => {
  it('uses the story-configured model when present', () => {
    const resolved = resolveModel('narrator', { narrator: 'custom/model' });

    expect(resolved.model).toBe('custom/model');
    expect(resolved.usedFallback).toBe(false);
  });

  it('falls back to the default rather than failing', () => {
    const resolved = resolveModel('narrator', {});

    expect(resolved.model).toBe(DEFAULT_MODELS.narrator);
    expect(resolved.usedFallback).toBe(true);
  });

  it('falls back on a null or undefined config', () => {
    expect(resolveModel('extractor', null).usedFallback).toBe(true);
    expect(resolveModel('extractor', undefined).usedFallback).toBe(true);
  });

  it('treats an empty model string as absent', () => {
    const resolved = resolveModel('narrator', { narrator: '' });

    expect(resolved.model).toBe(DEFAULT_MODELS.narrator);
    expect(resolved.usedFallback).toBe(true);
  });

  it('resolves roles independently of one another', () => {
    const config = { narrator: 'model/a', extractor: 'model/b' };

    expect(resolveModel('narrator', config).model).toBe('model/a');
    expect(resolveModel('extractor', config).model).toBe('model/b');
  });

  it('has a default for every role', () => {
    for (const role of MODEL_ROLES) {
      expect(DEFAULT_MODELS[role]).toBeTruthy();
    }
  });

  it('seeds a runnable config at story creation', () => {
    const config = defaultModelConfig();

    for (const role of MODEL_ROLES) {
      expect(resolveModel(role, config).usedFallback).toBe(false);
    }
  });

  it('rejects a role outside the defined table', () => {
    const result = modelConfigSchema.safeParse({ novelist: 'some/model' });
    expect(result.success).toBe(false);
  });
});
