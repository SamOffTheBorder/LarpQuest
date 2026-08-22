import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { callStructured, embedText, streamNarration, StructuredOutputError, type UsageRecorder } from './gateway';
import { SpendCapExceededError } from '@/lib/ai/budget';
import { allowAllBudget, denyingBudget } from '@/lib/ai/budget.test-helpers';

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
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const diffSchema = z.object({ field: z.string(), to: z.string() });

describe('callStructured', () => {
  it('routes to the role-resolved model and validates the response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: '{"field":"status","to":"injured"}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 },
      }),
    );

    const usage = recorder();

    const result = await callStructured(
      { apiKey: 'k', fetchImpl, usage, budget: allowAllBudget },
      {
        role: 'extractor',
        modelConfig: { extractor: 'custom/extractor-model' },
        systemPrompt: 'sys',
        userPrompt: 'user',
        schema: diffSchema,
        storyId: 's1',
      },
    );

    expect(result.data).toEqual({ field: 'status', to: 'injured' });
    expect(result.resolvedModel).toBe('custom/extractor-model');
    expect(result.usedFallbackModel).toBe(false);

    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toContain('/chat/completions');
    const body = JSON.parse(requestInit.body as string);
    expect(body.model).toBe('custom/extractor-model');

    expect(usage.calls).toHaveLength(1);
    expect(usage.calls[0]).toMatchObject({ role: 'extractor', succeeded: true, promptTokens: 10 });
  });

  it('falls back to the default model and reports the fallback in usage', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: '{"field":"status","to":"injured"}' } }],
        usage: {},
      }),
    );
    const usage = recorder();

    const result = await callStructured(
      { apiKey: 'k', fetchImpl, usage, budget: allowAllBudget },
      {
        role: 'extractor',
        modelConfig: {},
        systemPrompt: 'sys',
        userPrompt: 'user',
        schema: diffSchema,
        storyId: null,
      },
    );

    expect(result.usedFallbackModel).toBe(true);
    expect(usage.calls[0]?.usedFallbackModel).toBe(true);
  });

  it('retries once with the validation error appended, then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '{"field":"status"}' } }] }))
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: '{"field":"status","to":"injured"}' } }] }),
      );
    const usage = recorder();

    const result = await callStructured(
      { apiKey: 'k', fetchImpl, usage, budget: allowAllBudget },
      {
        role: 'extractor',
        modelConfig: {},
        systemPrompt: 'sys',
        userPrompt: 'user',
        schema: diffSchema,
        storyId: null,
      },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual({ field: 'status', to: 'injured' });

    // The retry prompt carries the validation error and the failed response.
    const secondCallBody = JSON.parse(
      (fetchImpl.mock.calls[1] as [string, RequestInit])[1].body as string,
    );
    const retryUserMessage = secondCallBody.messages[1].content as string;
    expect(retryUserMessage).toContain('failed validation');
    expect(retryUserMessage).toContain('"field":"status"');

    // Both attempts are logged, the failed one included.
    expect(usage.calls).toHaveLength(2);
    expect(usage.calls[0]?.succeeded).toBe(false);
    expect(usage.calls[1]?.succeeded).toBe(true);
  });

  it('raises StructuredOutputError after exhausting retries, without a third attempt', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'not json at all' } }] }));
    const usage = recorder();

    await expect(
      callStructured(
        { apiKey: 'k', fetchImpl, usage, budget: allowAllBudget },
        {
          role: 'extractor',
          modelConfig: {},
          systemPrompt: 'sys',
          userPrompt: 'user',
          schema: diffSchema,
          storyId: null,
        },
      ),
    ).rejects.toBeInstanceOf(StructuredOutputError);

    expect(fetchImpl).toHaveBeenCalledTimes(2); // exactly one retry, not unlimited
    expect(usage.calls).toHaveLength(2);
    expect(usage.calls.every((c) => !c.succeeded)).toBe(true);
  });

  it('treats prose where JSON was required as a validation failure, same retry path', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: 'Sure, here is my answer: it went well.' } }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: '{"field":"status","to":"injured"}' } }] }),
      );
    const usage = recorder();

    const result = await callStructured(
      { apiKey: 'k', fetchImpl, usage, budget: allowAllBudget },
      {
        role: 'extractor',
        modelConfig: {},
        systemPrompt: 'sys',
        userPrompt: 'user',
        schema: diffSchema,
        storyId: null,
      },
    );

    expect(result.data).toEqual({ field: 'status', to: 'injured' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('extracts JSON embedded in a fenced code block', async () => {
    const fenced = '```json\n{"field":"status","to":"injured"}\n```';
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: fenced } }] }));
    const usage = recorder();

    const result = await callStructured(
      { apiKey: 'k', fetchImpl, usage, budget: allowAllBudget },
      {
        role: 'validator',
        modelConfig: {},
        systemPrompt: 'sys',
        userPrompt: 'user',
        schema: diffSchema,
        storyId: null,
      },
    );

    expect(result.data).toEqual({ field: 'status', to: 'injured' });
  });

  it('logs usage and throws on an HTTP-level failure without retrying', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'rate limited' }, { ok: false, status: 429 }));
    const usage = recorder();

    await expect(
      callStructured(
        { apiKey: 'k', fetchImpl, usage, budget: allowAllBudget },
        {
          role: 'extractor',
          modelConfig: {},
          systemPrompt: 'sys',
          userPrompt: 'user',
          schema: diffSchema,
          storyId: null,
        },
      ),
    ).rejects.toThrow(/429/);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(usage.calls).toHaveLength(1);
    expect(usage.calls[0]?.succeeded).toBe(false);
  });

  it('resolves independently-configured roles to their own models', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: '{"field":"status","to":"injured"}' } }] }),
    );
    const usage = recorder();
    const modelConfig = { narrator: 'model/a', extractor: 'model/b' };

    await callStructured(
      { apiKey: 'k', fetchImpl, usage, budget: allowAllBudget },
      { role: 'extractor', modelConfig, systemPrompt: 's', userPrompt: 'u', schema: diffSchema, storyId: null },
    );

    const body = JSON.parse((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.model).toBe('model/b');
  });
});

describe('streamNarration', () => {
  function sseStream(chunks: string[]) {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
  }

  it('accumulates streamed chunks and reports them via onChunk', async () => {
    const stream = sseStream([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'The hall ' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'was empty.' } }] })}\n\n`,
      `data: ${JSON.stringify({ usage: { prompt_tokens: 20, completion_tokens: 8, cost: 0.002 } })}\n\n`,
      'data: [DONE]\n\n',
    ]);

    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, body: stream } as unknown as Response);
    const usage = recorder();
    const chunks: string[] = [];

    const result = await streamNarration(
      { apiKey: 'k', fetchImpl, usage, budget: allowAllBudget },
      {
        modelConfig: {},
        systemPrompt: 'sys',
        userPrompt: 'user',
        onChunk: (accumulated) => {
          chunks.push(accumulated);
        },
      },
    );

    expect(result.prose).toBe('The hall was empty.');
    expect(result.completed).toBe(true);
    expect(chunks).toEqual(['The hall ', 'The hall was empty.']);
    expect(usage.calls[0]).toMatchObject({ succeeded: true, promptTokens: 20, completionTokens: 8 });
  });

  it('returns partial prose with completed: false when the stream ends without [DONE]', async () => {
    // Simulates a timeout/abort mid-stream: the reader finishes without ever
    // seeing the terminal marker. Already-generated tokens must not be lost.
    const stream = sseStream([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Partial output' } }] })}\n\n`,
    ]);

    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, body: stream } as unknown as Response);
    const usage = recorder();

    const result = await streamNarration(
      { apiKey: 'k', fetchImpl, usage, budget: allowAllBudget },
      { modelConfig: {}, systemPrompt: 'sys', userPrompt: 'user', onChunk: () => {} },
    );

    expect(result.prose).toBe('Partial output');
    expect(result.completed).toBe(false);
    expect(usage.calls[0]?.succeeded).toBe(false); // billed tokens, still logged
  });

  it('always resolves the narrator role regardless of other role config', async () => {
    const stream = sseStream(['data: [DONE]\n\n']);
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, body: stream } as unknown as Response);
    const usage = recorder();

    await streamNarration(
      { apiKey: 'k', fetchImpl, usage, budget: allowAllBudget },
      {
        modelConfig: { narrator: 'custom/narrator', extractor: 'custom/extractor' },
        systemPrompt: 'sys',
        userPrompt: 'user',
        onChunk: () => {},
      },
    );

    const body = JSON.parse((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.model).toBe('custom/narrator');
    expect(usage.calls[0]?.role).toBe('narrator');
  });

  it('logs failed usage and throws when the HTTP request itself fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, body: null, text: async () => 'server error' } as unknown as Response);
    const usage = recorder();

    await expect(
      streamNarration(
        { apiKey: 'k', fetchImpl, usage, budget: allowAllBudget },
        { modelConfig: {}, systemPrompt: 'sys', userPrompt: 'user', onChunk: () => {} },
      ),
    ).rejects.toThrow(/500/);

    expect(usage.calls[0]?.succeeded).toBe(false);
  });
});

/**
 * The hard stop's whole value is that it cannot be bypassed by a call site, so
 * what is asserted here is that no HTTP request goes out at all — not merely
 * that an error surfaced.
 */
describe('spend cap enforcement', () => {
  const capError = new SpendCapExceededError('story', 30, 25);

  it('refuses a structured call before contacting the provider', async () => {
    const fetchImpl = vi.fn();
    const usage = recorder();

    await expect(
      callStructured(
        { apiKey: 'k', fetchImpl, usage, budget: denyingBudget(capError) },
        {
          role: 'extractor',
          modelConfig: {},
          systemPrompt: 's',
          userPrompt: 'u',
          schema: diffSchema,
          storyId: 'story-1',
        },
      ),
    ).rejects.toThrow(SpendCapExceededError);

    expect(fetchImpl).not.toHaveBeenCalled();
    // No tokens were billed, so there is nothing to log.
    expect(usage.calls).toHaveLength(0);
  });

  it('refuses narration before contacting the provider', async () => {
    const fetchImpl = vi.fn();
    const usage = recorder();

    await expect(
      streamNarration(
        { apiKey: 'k', fetchImpl, usage, budget: denyingBudget(capError) },
        { modelConfig: {}, systemPrompt: 's', userPrompt: 'u', onChunk: () => {} },
      ),
    ).rejects.toThrow(SpendCapExceededError);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(usage.calls).toHaveLength(0);
  });

  it('refuses embedding before contacting the provider', async () => {
    const fetchImpl = vi.fn();
    const usage = recorder();

    await expect(
      embedText(
        { apiKey: 'k', fetchImpl, usage, budget: denyingBudget(capError) },
        { modelConfig: {}, text: 'hello', storyId: 'story-1' },
      ),
    ).rejects.toThrow(SpendCapExceededError);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(usage.calls).toHaveLength(0);
  });
});
