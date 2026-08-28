import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { listFreeModels, FALLBACK_FREE_MODELS, __resetFreeModelsCache } = await import(
  '@/lib/ai/openrouter-models'
);

const okResponse = (data: unknown) =>
  ({ ok: true, json: async () => ({ data }) }) as unknown as Response;

beforeEach(() => {
  __resetFreeModelsCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listFreeModels', () => {
  it('keeps only entries priced at zero for both prompt and completion', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      okResponse([
        { id: 'a/free', name: 'A Free', pricing: { prompt: '0', completion: '0' } },
        { id: 'b/paid', name: 'B Paid', pricing: { prompt: '0.001', completion: '0' } },
        { id: 'c/paid', name: 'C Paid', pricing: { prompt: '0', completion: '0.002' } },
      ]),
    );

    const models = await listFreeModels();
    expect(models).toEqual([{ id: 'a/free', name: 'A Free' }]);
  });

  it('returns the fallback list when the fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const models = await listFreeModels();
    expect(models).toEqual(FALLBACK_FREE_MODELS);
  });

  it('returns the fallback list on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);
    const models = await listFreeModels();
    expect(models).toEqual(FALLBACK_FREE_MODELS);
  });

  it('serves a cache hit without a second fetch', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        okResponse([{ id: 'a/free', name: 'A Free', pricing: { prompt: '0', completion: '0' } }]),
      );

    await listFreeModels();
    await listFreeModels();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failure', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('blip')).mockResolvedValue(
      okResponse([{ id: 'a/free', name: 'A Free', pricing: { prompt: '0', completion: '0' } }]),
    );

    const first = await listFreeModels();
    expect(first).toEqual(FALLBACK_FREE_MODELS);

    const second = await listFreeModels();
    expect(second).toEqual([{ id: 'a/free', name: 'A Free' }]);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
