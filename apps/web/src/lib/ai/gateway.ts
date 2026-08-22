import 'server-only';

import { z } from 'zod';

import type { ModelConfig, ModelRole } from '@/lib/ai/roles';
import { resolveModel } from '@/lib/ai/roles';

/**
 * The OpenRouter gateway.
 *
 * This is the only module that talks to OpenRouter. Every call goes through
 * `callStructured`, `embedText`, or `streamNarration`. All three resolve their
 * model from a role, check the injected `BudgetGuard` before spending, and
 * report usage through the injected `UsageRecorder` — including on failure,
 * since a provider may have already billed tokens by the time an error
 * surfaces.
 *
 * The HTTP client is injected as `fetchImpl` so tests never hit the network.
 */

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export interface UsageRecorder {
  record(entry: {
    role: ModelRole;
    model: string;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    succeeded: boolean;
    usedFallbackModel: boolean;
  }): Promise<void>;
}

/**
 * Pre-call spend enforcement. Throws `SpendCapExceededError` when the story or
 * user has reached its cap.
 *
 * Injected alongside the UsageRecorder rather than called at the call sites,
 * for the same reason model resolution lives here: a check a call site can
 * forget is not a hard stop. See `lib/ai/budget.ts` for the policy and
 * `lib/ai/spend.ts` for the implementation.
 */
export interface BudgetGuard {
  assertWithinBudget(): Promise<void>;
}

export interface GatewayDeps {
  apiKey: string;
  fetchImpl?: typeof fetch;
  usage: UsageRecorder;
  budget: BudgetGuard;
}

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  // OpenRouter reports cost directly when usage.include is requested, rather
  // than requiring the caller to price tokens against a rate table that goes
  // stale the moment a provider changes pricing.
  cost?: number;
}

interface OpenRouterChoice {
  message?: { content?: string | null };
  delta?: { content?: string | null };
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  usage?: OpenRouterUsage;
}

const MAX_STRUCTURED_ATTEMPTS = 2; // one shot, one retry, per Part 5.1 / ai-gateway spec

export class StructuredOutputError extends Error {
  constructor(
    readonly role: ModelRole,
    readonly attempts: number,
    readonly lastRawResponse: string,
    cause: unknown,
  ) {
    super(
      `Structured output for role "${role}" failed validation after ${attempts} attempt(s).`,
      { cause },
    );
    this.name = 'StructuredOutputError';
  }
}

interface CallStructuredArgs<T> {
  role: ModelRole;
  modelConfig: ModelConfig | null | undefined;
  systemPrompt: string;
  userPrompt: string;
  schema: z.ZodType<T>;
  storyId: string | null;
}

async function postChatCompletion(
  deps: GatewayDeps,
  args: { model: string; messages: { role: 'system' | 'user'; content: string }[]; stream?: boolean },
): Promise<Response> {
  const doFetch = deps.fetchImpl ?? fetch;

  return doFetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deps.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      stream: args.stream ?? false,
      usage: { include: true },
    }),
  });
}

function extractJson(raw: string): unknown {
  // Models occasionally wrap JSON in prose or a fenced code block despite
  // instructions. Try a direct parse first, then the largest {...} or [...]
  // span, before giving up — this is a convenience, not a validation bypass;
  // the Zod schema still gates everything that follows.
  try {
    return JSON.parse(raw);
  } catch {
    // fall through
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1] !== undefined) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // fall through
    }
  }

  const braceStart = raw.indexOf('{');
  const bracketStart = raw.indexOf('[');
  const start =
    braceStart === -1 ? bracketStart : bracketStart === -1 ? braceStart : Math.min(braceStart, bracketStart);

  if (start !== -1) {
    const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
    if (end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
  }

  throw new SyntaxError('Response did not contain parseable JSON.');
}

/**
 * Call a role expecting structured output, validated through the given Zod
 * schema. Malformed output — including prose where JSON was required — retries
 * once with the validation error appended to the prompt, then raises
 * StructuredOutputError. Unvalidated output never reaches the caller.
 */
export async function callStructured<T>(
  deps: GatewayDeps,
  args: CallStructuredArgs<T>,
): Promise<{ data: T; resolvedModel: string; usedFallbackModel: boolean }> {
  // Before the retry loop, not inside it: the retry is part of one logical
  // call, and its tokens are already billed to the same budget.
  await deps.budget.assertWithinBudget();

  const resolved = resolveModel(args.role, args.modelConfig);

  let userPrompt = args.userPrompt;
  let lastRaw = '';
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_STRUCTURED_ATTEMPTS; attempt += 1) {
    const response = await postChatCompletion(deps, {
      model: resolved.model,
      messages: [
        { role: 'system', content: args.systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    if (!response.ok) {
      const body = await response.text();
      await deps.usage.record({
        role: args.role,
        model: resolved.model,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        succeeded: false,
        usedFallbackModel: resolved.usedFallback,
      });
      throw new Error(`OpenRouter request failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as OpenRouterResponse;
    const content = payload.choices?.[0]?.message?.content ?? '';
    lastRaw = content;

    const promptTokens = payload.usage?.prompt_tokens ?? 0;
    const completionTokens = payload.usage?.completion_tokens ?? 0;
    const costUsd = payload.usage?.cost ?? 0;

    let parsed: T;
    try {
      const json = extractJson(content);
      parsed = args.schema.parse(json);
    } catch (error) {
      lastError = error;

      // Tokens were billed for this attempt regardless of whether the shape
      // was usable — log it even though we are about to retry or fail.
      await deps.usage.record({
        role: args.role,
        model: resolved.model,
        promptTokens,
        completionTokens,
        costUsd,
        succeeded: false,
        usedFallbackModel: resolved.usedFallback,
      });

      if (attempt < MAX_STRUCTURED_ATTEMPTS) {
        const errorMessage = error instanceof z.ZodError ? error.message : String(error);
        userPrompt = `${args.userPrompt}\n\nYour previous response failed validation:\n${errorMessage}\n\nPrevious response:\n${content}\n\nRespond again with valid JSON matching the required shape.`;
        continue;
      }

      throw new StructuredOutputError(args.role, attempt, lastRaw, lastError);
    }

    await deps.usage.record({
      role: args.role,
      model: resolved.model,
      promptTokens,
      completionTokens,
      costUsd,
      succeeded: true,
      usedFallbackModel: resolved.usedFallback,
    });

    return { data: parsed, resolvedModel: resolved.model, usedFallbackModel: resolved.usedFallback };
  }

  // Unreachable: the loop always returns or throws. Satisfies the type
  // checker without a non-null assertion.
  throw new StructuredOutputError(args.role, MAX_STRUCTURED_ATTEMPTS, lastRaw, lastError);
}

interface OpenRouterEmbeddingResponse {
  data?: { embedding?: number[] }[];
  usage?: OpenRouterUsage;
}

export class EmbeddingError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'EmbeddingError';
  }
}

interface EmbedTextArgs {
  modelConfig: ModelConfig | null | undefined;
  text: string;
  storyId: string | null;
}

/**
 * Embed text through the `embedder` role. Unlike `callStructured`, there is no
 * retry-with-error-appended loop — a malformed embedding response is not a
 * validation failure a model can correct by trying again, it is a transport or
 * provider problem, so this fails once and lets the caller (the memory
 * worker) mark the job failed and retry the whole job later.
 */
export async function embedText(
  deps: GatewayDeps,
  args: EmbedTextArgs,
): Promise<{ embedding: number[]; resolvedModel: string; usedFallbackModel: boolean }> {
  await deps.budget.assertWithinBudget();

  const resolved = resolveModel('embedder', args.modelConfig);
  const doFetch = deps.fetchImpl ?? fetch;

  const response = await doFetch(`${OPENROUTER_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deps.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: resolved.model,
      input: args.text,
      usage: { include: true },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    await deps.usage.record({
      role: 'embedder',
      model: resolved.model,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      succeeded: false,
      usedFallbackModel: resolved.usedFallback,
    });
    throw new EmbeddingError(`OpenRouter embedding request failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as OpenRouterEmbeddingResponse;
  const embedding = payload.data?.[0]?.embedding;

  const promptTokens = payload.usage?.prompt_tokens ?? 0;
  const costUsd = payload.usage?.cost ?? 0;

  if (embedding === undefined || embedding.length === 0) {
    await deps.usage.record({
      role: 'embedder',
      model: resolved.model,
      promptTokens,
      completionTokens: 0,
      costUsd,
      succeeded: false,
      usedFallbackModel: resolved.usedFallback,
    });
    throw new EmbeddingError('OpenRouter embedding response contained no vector.');
  }

  await deps.usage.record({
    role: 'embedder',
    model: resolved.model,
    promptTokens,
    completionTokens: 0,
    costUsd,
    succeeded: true,
    usedFallbackModel: resolved.usedFallback,
  });

  return { embedding, resolvedModel: resolved.model, usedFallbackModel: resolved.usedFallback };
}

export interface StreamNarrationArgs {
  modelConfig: ModelConfig | null | undefined;
  systemPrompt: string;
  userPrompt: string;
  /** Called with the full accumulated text so far, as each chunk arrives. */
  onChunk: (accumulatedText: string) => void | Promise<void>;
}

export interface StreamNarrationResult {
  prose: string;
  resolvedModel: string;
  usedFallbackModel: boolean;
  /** False when the stream ended without a clean finish (e.g. aborted). */
  completed: boolean;
}

function parseSseLine(line: string): { done: true } | { done: false; payload: OpenRouterResponse } | null {
  if (!line.startsWith('data:')) {
    return null;
  }

  const data = line.slice(5).trim();

  if (data === '[DONE]') {
    return { done: true };
  }

  try {
    return { done: false, payload: JSON.parse(data) as OpenRouterResponse };
  } catch {
    return null;
  }
}

/**
 * Stream a narration call, flushing accumulated prose to `onChunk` as it
 * arrives. A timeout or abort after partial output still returns what was
 * generated with `completed: false`, so the caller can persist it rather than
 * discarding tokens the provider already billed.
 */
export async function streamNarration(
  deps: GatewayDeps,
  args: StreamNarrationArgs,
): Promise<StreamNarrationResult> {
  await deps.budget.assertWithinBudget();

  const resolved = resolveModel('narrator', args.modelConfig);

  const response = await postChatCompletion(deps, {
    model: resolved.model,
    messages: [
      { role: 'system', content: args.systemPrompt },
      { role: 'user', content: args.userPrompt },
    ],
    stream: true,
  });

  if (!response.ok || response.body === null) {
    const body = response.body === null ? '' : await response.text();
    await deps.usage.record({
      role: 'narrator',
      model: resolved.model,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      succeeded: false,
      usedFallbackModel: resolved.usedFallback,
    });
    throw new Error(`OpenRouter streaming request failed (${response.status}): ${body}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let accumulated = '';
  let buffer = '';
  let usage: OpenRouterUsage | undefined;
  let completed = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const parsed = parseSseLine(line);
        if (parsed === null) {
          continue;
        }
        if (parsed.done) {
          completed = true;
          continue;
        }

        const delta = parsed.payload.choices?.[0]?.delta?.content ?? '';
        if (delta.length > 0) {
          accumulated += delta;
          await args.onChunk(accumulated);
        }

        if (parsed.payload.usage !== undefined) {
          usage = parsed.payload.usage;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  await deps.usage.record({
    role: 'narrator',
    model: resolved.model,
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    costUsd: usage?.cost ?? 0,
    succeeded: completed,
    usedFallbackModel: resolved.usedFallback,
  });

  return {
    prose: accumulated,
    resolvedModel: resolved.model,
    usedFallbackModel: resolved.usedFallback,
    completed,
  };
}
