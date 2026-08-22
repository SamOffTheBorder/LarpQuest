import 'server-only';

import type { ModelConfig } from '@/lib/ai/roles';
import { resolveModel } from '@/lib/ai/roles';
import type { BudgetGuard, UsageRecorder } from '@/lib/ai/gateway';

/**
 * The media gateway: image and video generation.
 *
 * `gateway.ts`'s `callStructured`/`embedText` are built around OpenRouter's
 * chat-completions/embeddings contract — token-priced, JSON-or-text output.
 * Image and video generation return binary/URL output priced per-asset
 * (image) or per-second (video), and video generation is an async job rather
 * than a single request/response. That different shape is why this is a
 * separate module rather than a branch inside `gateway.ts`.
 *
 * `illustrator` still resolves through OpenRouter's image-output support.
 * `videographer` does not — no current-generation video model is served by
 * OpenRouter, so `generateVideo` calls a direct provider API. Both still
 * resolve their model via `resolveModel(role, config)` and both still write
 * a `usage_log` row through the injected `UsageRecorder` on every attempt,
 * success or failure — the role-resolution and cost-recording contract is
 * unchanged, only the transport differs.
 */

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export interface MediaGatewayDeps {
  /** OpenRouter key, used for the illustrator (image-output) call. */
  openRouterApiKey: string;
  /** Direct video-provider key, used for the videographer call. */
  videoProviderApiKey: string;
  videoProviderBaseUrl?: string;
  fetchImpl?: typeof fetch;
  usage: UsageRecorder;
  /**
   * Same hard stop as the text gateway. Image and video calls are among the
   * most expensive per call in the system, so exempting them would leave the
   * largest hole in the cap.
   */
  budget: BudgetGuard;
}

export class MediaGenerationError extends Error {
  constructor(
    readonly role: 'illustrator' | 'videographer',
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'MediaGenerationError';
  }
}

interface GenerateImageArgs {
  modelConfig: ModelConfig | null | undefined;
  prompt: string;
  storyId: string | null;
}

interface GenerateImageResult {
  /** Raw image bytes, ready to upload to Storage. */
  imageBytes: Uint8Array;
  contentType: string;
  resolvedModel: string;
  usedFallbackModel: boolean;
}

interface OpenRouterImageResponse {
  choices?: {
    message?: {
      images?: { image_url?: { url?: string } }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

function decodeDataUrl(url: string): { bytes: Uint8Array; contentType: string } {
  const match = /^data:([^;]+);base64,(.+)$/.exec(url);
  const contentType = match?.[1];
  const base64 = match?.[2];
  if (contentType === undefined || base64 === undefined) {
    throw new Error('Image provider returned a URL, not inline data — remote fetch not implemented.');
  }
  return { bytes: Uint8Array.from(Buffer.from(base64, 'base64')), contentType };
}

/**
 * Render one manga-style panel image from an illustrator-role prompt.
 *
 * Failure — a non-2xx response, or a response with no image payload — always
 * records a `usage_log` row before throwing `MediaGenerationError`, since a
 * provider may have already billed the attempt.
 */
export async function generateImage(
  deps: MediaGatewayDeps,
  args: GenerateImageArgs,
): Promise<GenerateImageResult> {
  await deps.budget.assertWithinBudget();

  const resolved = resolveModel('illustrator', args.modelConfig);
  const doFetch = deps.fetchImpl ?? fetch;

  const response = await doFetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deps.openRouterApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: resolved.model,
      messages: [
        {
          role: 'user',
          content: `Manga-style panel illustration. ${args.prompt}`,
        },
      ],
      modalities: ['image', 'text'],
      usage: { include: true },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    await deps.usage.record({
      role: 'illustrator',
      model: resolved.model,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      succeeded: false,
      usedFallbackModel: resolved.usedFallback,
    });
    throw new MediaGenerationError('illustrator', `Image generation failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as OpenRouterImageResponse;
  const promptTokens = payload.usage?.prompt_tokens ?? 0;
  const completionTokens = payload.usage?.completion_tokens ?? 0;
  const costUsd = payload.usage?.cost ?? 0;
  const imageUrl = payload.choices?.[0]?.message?.images?.[0]?.image_url?.url;

  if (imageUrl === undefined) {
    await deps.usage.record({
      role: 'illustrator',
      model: resolved.model,
      promptTokens,
      completionTokens,
      costUsd,
      succeeded: false,
      usedFallbackModel: resolved.usedFallback,
    });
    throw new MediaGenerationError('illustrator', 'Image generation response contained no image.');
  }

  const { bytes, contentType } = decodeDataUrl(imageUrl);

  await deps.usage.record({
    role: 'illustrator',
    model: resolved.model,
    promptTokens,
    completionTokens,
    costUsd,
    succeeded: true,
    usedFallbackModel: resolved.usedFallback,
  });

  return { imageBytes: bytes, contentType, resolvedModel: resolved.model, usedFallbackModel: resolved.usedFallback };
}

interface GenerateVideoArgs {
  modelConfig: ModelConfig | null | undefined;
  /** The chapter's manga-panel image, used to seed an image-to-video call. */
  sourceImageBytes: Uint8Array;
  sourceImageContentType: string;
  prompt: string;
  storyId: string | null;
}

interface GenerateVideoResult {
  videoBytes: Uint8Array;
  contentType: string;
  resolvedModel: string;
  usedFallbackModel: boolean;
}

interface VideoProviderResponse {
  status?: string;
  video_url?: string;
  error?: string;
}

/**
 * Render one anime-style video clip, seeded by a chapter's completed image.
 *
 * Unlike `generateImage`, this hits a direct provider API rather than
 * OpenRouter — see the module comment. The caller (the Inngest job in
 * `chapter-video.ts`) is responsible for polling if the provider's API is
 * itself asynchronous; this function represents one such poll/submit
 * round-trip and reports `usage_log` on every call, including a failure
 * after the provider has already billed for partial generation.
 */
export async function generateVideo(
  deps: MediaGatewayDeps,
  args: GenerateVideoArgs,
): Promise<GenerateVideoResult> {
  await deps.budget.assertWithinBudget();

  const resolved = resolveModel('videographer', args.modelConfig);
  const doFetch = deps.fetchImpl ?? fetch;
  const baseUrl = deps.videoProviderBaseUrl ?? 'https://api.video-provider.example/v1';

  const response = await doFetch(`${baseUrl}/generate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deps.videoProviderApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: resolved.model,
      prompt: `Anime-style animation. ${args.prompt}`,
      image: Buffer.from(args.sourceImageBytes).toString('base64'),
      image_content_type: args.sourceImageContentType,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    await deps.usage.record({
      role: 'videographer',
      model: resolved.model,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      succeeded: false,
      usedFallbackModel: resolved.usedFallback,
    });
    throw new MediaGenerationError('videographer', `Video generation failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as VideoProviderResponse;

  if (payload.status !== 'complete' || payload.video_url === undefined) {
    // The provider may have already billed for compute even though the job
    // did not produce a usable result — record the attempt regardless.
    await deps.usage.record({
      role: 'videographer',
      model: resolved.model,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      succeeded: false,
      usedFallbackModel: resolved.usedFallback,
    });
    throw new MediaGenerationError(
      'videographer',
      payload.error ?? 'Video generation did not complete successfully.',
    );
  }

  const videoResponse = await doFetch(payload.video_url);
  if (!videoResponse.ok) {
    await deps.usage.record({
      role: 'videographer',
      model: resolved.model,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      succeeded: false,
      usedFallbackModel: resolved.usedFallback,
    });
    throw new MediaGenerationError('videographer', 'Video generation succeeded but the result could not be fetched.');
  }

  const contentType = videoResponse.headers.get('content-type') ?? 'video/mp4';
  const videoBytes = new Uint8Array(await videoResponse.arrayBuffer());

  await deps.usage.record({
    role: 'videographer',
    model: resolved.model,
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    succeeded: true,
    usedFallbackModel: resolved.usedFallback,
  });

  return { videoBytes, contentType, resolvedModel: resolved.model, usedFallbackModel: resolved.usedFallback };
}
