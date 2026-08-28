import 'server-only';

import { encryptSecret, decryptSecret } from '@/lib/crypto';
import { serverEnv } from '@/lib/env';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * OpenRouter API key resolution.
 *
 * A user may save their own OpenRouter key in account settings; it is stored
 * encrypted (AES-256-GCM, see crypto.ts) as a single `scope='user'`,
 * `provider='openrouter'` row in `api_keys`. When a story generates, the
 * gateway resolves which key to bill: the story's `gm` member's key, else the
 * `owner`'s key, else the platform environment key.
 *
 * All functions here use the service-role client — call sites are server
 * engine code acting outside any one user's request, and RLS on `api_keys` is
 * scoped to `owner_id = auth.uid()`, which a service-role call does not carry.
 * Membership is checked explicitly where it matters.
 */

const PROVIDER = 'openrouter';
const USER_SCOPE = 'user';

export type ApiKeySource = 'gm' | 'owner' | 'platform';

export interface StoredUserApiKey {
  encryptedKey: string;
  label: string | null;
  createdAt: string;
}

/** Last 4 characters of a key, for a masked display value. Server-only. */
export function fingerprint(plaintext: string): string {
  return plaintext.slice(-4);
}

/**
 * A permissive shape check. OpenRouter keys currently look like
 * `sk-or-v1-...`, but the prefix is not contractual, so this only rejects the
 * obviously-wrong: empty, whitespace, or implausibly short.
 */
export function looksLikeApiKey(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 16 && !/\s/.test(trimmed);
}

/** The user's stored OpenRouter key row, or null if they have none. */
export async function getUserApiKey(userId: string): Promise<StoredUserApiKey | null> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from('api_keys')
    .select('encrypted_key, label, created_at')
    .eq('owner_id', userId)
    .eq('scope', USER_SCOPE)
    .eq('provider', PROVIDER)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read API key: ${error.message}`);
  }

  if (data === null) {
    return null;
  }

  return { encryptedKey: data.encrypted_key, label: data.label, createdAt: data.created_at };
}

/**
 * Save (or replace) the user's OpenRouter key. At most one user-scoped
 * OpenRouter row exists per user — this deletes any existing one first, since
 * `api_keys` has no unique constraint to `on conflict` against.
 */
export async function saveUserApiKey(userId: string, plaintext: string): Promise<void> {
  if (!looksLikeApiKey(plaintext)) {
    throw new Error('That does not look like an API key.');
  }

  const supabase = createServiceRoleClient();

  const { error: deleteError } = await supabase
    .from('api_keys')
    .delete()
    .eq('owner_id', userId)
    .eq('scope', USER_SCOPE)
    .eq('provider', PROVIDER);

  if (deleteError !== null) {
    throw new Error(`Failed to replace API key: ${deleteError.message}`);
  }

  const { error: insertError } = await supabase.from('api_keys').insert({
    owner_id: userId,
    scope: USER_SCOPE,
    provider: PROVIDER,
    encrypted_key: encryptSecret(plaintext.trim()),
  });

  if (insertError !== null) {
    throw new Error(`Failed to save API key: ${insertError.message}`);
  }
}

export async function deleteUserApiKey(userId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  const { error } = await supabase
    .from('api_keys')
    .delete()
    .eq('owner_id', userId)
    .eq('scope', USER_SCOPE)
    .eq('provider', PROVIDER);

  if (error !== null) {
    throw new Error(`Failed to remove API key: ${error.message}`);
  }
}

/** Decrypt a stored row, or return null if it is unreadable rather than throwing. */
function safeDecrypt(encrypted: string): string | null {
  try {
    return decryptSecret(encrypted);
  } catch {
    // A row encrypted under a rotated master key, or corrupted. Skip it and
    // fall through to the next resolution source rather than failing the call.
    return null;
  }
}

/**
 * Resolve the OpenRouter key to bill for a story's generation:
 * the `gm` member's stored key, else the `owner`'s, else the platform key.
 */
export async function resolveStoryApiKey(
  storyId: string,
): Promise<{ key: string; source: ApiKeySource }> {
  const supabase = createServiceRoleClient();

  const [{ data: story }, { data: gmMember }] = await Promise.all([
    supabase.from('stories').select('owner_id').eq('id', storyId).maybeSingle(),
    supabase
      .from('story_members')
      .select('user_id')
      .eq('story_id', storyId)
      .eq('role', 'gm')
      .limit(1)
      .maybeSingle(),
  ]);

  const candidates: { userId: string; source: ApiKeySource }[] = [];
  if (gmMember?.user_id != null) {
    candidates.push({ userId: gmMember.user_id, source: 'gm' });
  }
  if (story?.owner_id != null) {
    candidates.push({ userId: story.owner_id, source: 'owner' });
  }

  for (const candidate of candidates) {
    const stored = await getUserApiKey(candidate.userId);
    if (stored === null) {
      continue;
    }
    const decrypted = safeDecrypt(stored.encryptedKey);
    if (decrypted !== null) {
      return { key: decrypted, source: candidate.source };
    }
  }

  return { key: platformOpenRouterKey(), source: 'platform' };
}

/**
 * The platform OpenRouter key, or `''` if none is configured.
 *
 * Not an error by itself: a story whose every role resolves to an `ollama/`
 * model never sends this key anywhere (`gateway.ts` only reads `apiKey` on
 * the OpenRouter branch), so requiring `OPENROUTER_API_KEY` here would break
 * fully-local deployments that never needed it. If a role *does* resolve to
 * an OpenRouter model with this empty, the request fails with OpenRouter's
 * own 401 — a clear enough signal without duplicating that check here.
 */
function platformOpenRouterKey(): string {
  return serverEnv().OPENROUTER_API_KEY ?? '';
}

/** The platform key, for call paths with no story context (e.g. some research runs). */
export function resolvePlatformApiKey(): { key: string; source: ApiKeySource } {
  return { key: platformOpenRouterKey(), source: 'platform' };
}

/**
 * Resolve the key to bill for a call made by a user with no story yet —
 * premise generation, which runs before the story it describes exists.
 *
 * `resolveStoryApiKey`'s gm → owner → platform order has no meaning here:
 * neither role exists, so it is the user's own key, else the platform's.
 */
export async function resolveUserApiKey(
  userId: string,
): Promise<{ key: string; source: ApiKeySource }> {
  const stored = await getUserApiKey(userId);

  if (stored !== null) {
    const decrypted = safeDecrypt(stored.encryptedKey);
    if (decrypted !== null) {
      return { key: decrypted, source: 'owner' };
    }
  }

  return { key: platformOpenRouterKey(), source: 'platform' };
}
