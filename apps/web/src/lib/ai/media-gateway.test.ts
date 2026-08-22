import { describe, expect, it, vi } from 'vitest';

import { generateImage, generateVideo, MediaGenerationError, type MediaGatewayDeps } from './media-gateway';
import type { UsageRecorder } from './gateway';
import { allowAllBudget } from '@/lib/ai/budget.test-helpers';

function recorder(): UsageRecorder & { calls: Parameters<UsageRecorder['record']>[0][] } {
  const calls: Parameters<UsageRecorder['record']>[0][] = [];
  return {
    calls,
    record: async (entry) => {
      calls.push(entry);
    },
  };
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: new Headers({ 'content-type': 'video/mp4' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  } as unknown as Response;
}

const ONE_PIXEL_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function baseDeps(overrides: Partial<MediaGatewayDeps> = {}): MediaGatewayDeps {
  return {
    openRouterApiKey: 'or-key',
    videoProviderApiKey: 'video-key',
    usage: recorder(),
    budget: allowAllBudget,
    ...overrides,
  };
}

describe('generateImage', () => {
  it('resolves the illustrator role, decodes the image, and records usage', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { images: [{ image_url: { url: ONE_PIXEL_PNG_DATA_URL } }] } }],
        usage: { prompt_tokens: 20, completion_tokens: 0, cost: 0.01 },
      }),
    );
    const usage = recorder();

    const result = await generateImage(
      { ...baseDeps(), fetchImpl, usage },
      { modelConfig: { illustrator: 'custom/illustrator-model' }, prompt: 'a hero at dawn', storyId: 's1' },
    );

    expect(result.resolvedModel).toBe('custom/illustrator-model');
    expect(result.usedFallbackModel).toBe(false);
    expect(result.contentType).toBe('image/png');
    expect(result.imageBytes.length).toBeGreaterThan(0);

    const [requestUrl] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toContain('/chat/completions');

    expect(usage.calls).toHaveLength(1);
    expect(usage.calls[0]).toMatchObject({ role: 'illustrator', succeeded: true, promptTokens: 20 });
  });

  it('falls back to the default model when unconfigured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { images: [{ image_url: { url: ONE_PIXEL_PNG_DATA_URL } }] } }],
        usage: {},
      }),
    );

    const result = await generateImage(
      { ...baseDeps(), fetchImpl },
      { modelConfig: {}, prompt: 'a hero at dawn', storyId: null },
    );

    expect(result.usedFallbackModel).toBe(true);
  });

  it('records failed usage and throws when the provider errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad request' }, { ok: false, status: 400 }));
    const usage = recorder();

    await expect(
      generateImage({ ...baseDeps(), fetchImpl, usage }, { modelConfig: {}, prompt: 'x', storyId: null }),
    ).rejects.toThrow(MediaGenerationError);

    expect(usage.calls).toHaveLength(1);
    expect(usage.calls[0]).toMatchObject({ role: 'illustrator', succeeded: false });
  });

  it('records failed usage and throws when the response has no image', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: {} }], usage: {} }));
    const usage = recorder();

    await expect(
      generateImage({ ...baseDeps(), fetchImpl, usage }, { modelConfig: {}, prompt: 'x', storyId: null }),
    ).rejects.toThrow(MediaGenerationError);

    expect(usage.calls[0]).toMatchObject({ role: 'illustrator', succeeded: false });
  });
});

describe('generateVideo', () => {
  const sourceImageBytes = new Uint8Array([9, 9, 9]);

  it('resolves the videographer role, fetches the result, and records usage', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'complete', video_url: 'https://provider.example/out.mp4' }))
      .mockResolvedValueOnce(jsonResponse({}));
    const usage = recorder();

    const result = await generateVideo(
      { ...baseDeps(), fetchImpl, usage },
      {
        modelConfig: { videographer: 'custom/video-model' },
        sourceImageBytes,
        sourceImageContentType: 'image/png',
        prompt: 'the hero leaps',
        storyId: 's1',
      },
    );

    expect(result.resolvedModel).toBe('custom/video-model');
    expect(result.usedFallbackModel).toBe(false);
    expect(result.videoBytes.length).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('https://provider.example/out.mp4');

    expect(usage.calls).toHaveLength(1);
    expect(usage.calls[0]).toMatchObject({ role: 'videographer', succeeded: true });
  });

  it('records failed usage and throws when the provider request errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'quota exceeded' }, { ok: false, status: 429 }));
    const usage = recorder();

    await expect(
      generateVideo(
        { ...baseDeps(), fetchImpl, usage },
        { modelConfig: {}, sourceImageBytes, sourceImageContentType: 'image/png', prompt: 'x', storyId: null },
      ),
    ).rejects.toThrow(MediaGenerationError);

    expect(usage.calls).toHaveLength(1);
    expect(usage.calls[0]).toMatchObject({ role: 'videographer', succeeded: false });
  });

  it('records failed usage when the provider bills for a job that fails to complete', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: 'failed', error: 'generation error' }));
    const usage = recorder();

    await expect(
      generateVideo(
        { ...baseDeps(), fetchImpl, usage },
        { modelConfig: {}, sourceImageBytes, sourceImageContentType: 'image/png', prompt: 'x', storyId: null },
      ),
    ).rejects.toThrow('generation error');

    expect(usage.calls).toHaveLength(1);
    expect(usage.calls[0]).toMatchObject({ role: 'videographer', succeeded: false });
  });
});
