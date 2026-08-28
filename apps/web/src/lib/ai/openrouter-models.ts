import 'server-only';

/**
 * The list of zero-priced ("free") OpenRouter models, for the story model
 * picker. Fetched from OpenRouter's public models endpoint, filtered to
 * entries whose prompt and completion prices are both "0", and cached
 * in-process for an hour. A fetch or parse failure returns a small hardcoded
 * fallback and is not cached, so a transient outage does not pin the app to
 * the fallback for an hour.
 */

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_TTL_MS = 60 * 60 * 1000;

export interface FreeModel {
  id: string;
  name: string;
}

/**
 * Known free model ids, used when the live list cannot be fetched. Kept short
 * and conservative — these have been stable `:free` slugs on OpenRouter.
 * Re-check if the picker starts offering dead ids.
 */
export const FALLBACK_FREE_MODELS: FreeModel[] = [
  { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (free)' },
  { id: 'deepseek/deepseek-chat:free', name: 'DeepSeek Chat (free)' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B Instruct (free)' },
  { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash Experimental (free)' },
  { id: 'mistralai/mistral-7b-instruct:free', name: 'Mistral 7B Instruct (free)' },
  { id: 'qwen/qwen-2.5-72b-instruct:free', name: 'Qwen 2.5 72B Instruct (free)' },
];

interface OpenRouterModel {
  id?: string;
  name?: string;
  pricing?: { prompt?: string; completion?: string };
}

interface OpenRouterModelsResponse {
  data?: OpenRouterModel[];
}

let cache: { at: number; models: FreeModel[] } | null = null;

function isFree(model: OpenRouterModel): boolean {
  return model.pricing?.prompt === '0' && model.pricing?.completion === '0';
}

/** Reset the in-process cache. Test-only. */
export function __resetFreeModelsCache(): void {
  cache = null;
}

export async function listFreeModels(): Promise<FreeModel[]> {
  if (cache !== null && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.models;
  }

  try {
    const response = await fetch(MODELS_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      return FALLBACK_FREE_MODELS;
    }

    const payload = (await response.json()) as OpenRouterModelsResponse;
    const models = (payload.data ?? [])
      .filter(isFree)
      .filter((m): m is OpenRouterModel & { id: string } => typeof m.id === 'string' && m.id.length > 0)
      .map((m) => ({ id: m.id, name: m.name ?? m.id }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (models.length === 0) {
      return FALLBACK_FREE_MODELS;
    }

    cache = { at: Date.now(), models };
    return models;
  } catch {
    return FALLBACK_FREE_MODELS;
  }
}
