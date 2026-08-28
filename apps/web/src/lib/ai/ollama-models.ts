import 'server-only';

import { OLLAMA_PREFIX } from '@/lib/ai/roles';
import { serverEnv } from '@/lib/env';

/**
 * The list of models installed on the local Ollama server, for the story
 * model picker's "Local (Ollama)" group. Fetched from Ollama's `/api/tags`
 * (not an OpenAI-compat path — that's `/v1`, this is Ollama's own API) and
 * cached in-process briefly: unlike OpenRouter's catalog this can change
 * within a session (`ollama pull` while the app is running), so the cache is
 * short-lived rather than hour-long.
 *
 * A fetch failure (most commonly: Ollama isn't running) returns an empty
 * list rather than throwing — this is a picker convenience, not a
 * requirement, and a deployment with no local Ollama server simply shows no
 * local options.
 */

const CACHE_TTL_MS = 30 * 1000;

export interface LocalModel {
  /** Routable id, e.g. `ollama/qwen3.6:35b-a3b` — see roles.ts's OLLAMA_PREFIX. */
  id: string;
  name: string;
}

interface OllamaTagsModel {
  name?: string;
  details?: { parameter_size?: string };
}

interface OllamaTagsResponse {
  models?: OllamaTagsModel[];
}

let cache: { at: number; models: LocalModel[] } | null = null;

/** Reset the in-process cache. Test-only. */
export function __resetLocalModelsCache(): void {
  cache = null;
}

export async function listLocalModels(): Promise<LocalModel[]> {
  if (cache !== null && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.models;
  }

  try {
    const baseUrl = serverEnv().OLLAMA_BASE_URL;
    const response = await fetch(`${baseUrl}/api/tags`, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as OllamaTagsResponse;
    const models = (payload.models ?? [])
      .filter((m): m is OllamaTagsModel & { name: string } => typeof m.name === 'string' && m.name.length > 0)
      .map((m) => ({
        id: `${OLLAMA_PREFIX}${m.name}`,
        name: m.details?.parameter_size !== undefined ? `${m.name} (${m.details.parameter_size})` : m.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    cache = { at: Date.now(), models };
    return models;
  } catch {
    return [];
  }
}
