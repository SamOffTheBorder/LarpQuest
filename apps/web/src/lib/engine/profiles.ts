import 'server-only';

import { z } from 'zod';

import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Usernames.
 *
 * A display name every account sets once and can change later. Stored in its
 * own table rather than auth user_metadata: metadata is not queryable for a
 * uniqueness check, and resolving a roster of uuids to names needs a real
 * join-shaped read.
 */

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Usernames must be at least 3 characters.')
  .max(32, 'Usernames must be at most 32 characters.')
  .regex(/^[A-Za-z0-9_-]+$/, 'Usernames may only use letters, numbers, underscores, and hyphens.');

export class UsernameTakenError extends Error {
  constructor(readonly username: string) {
    super(`The username "${username}" is already taken.`);
    this.name = 'UsernameTakenError';
  }
}

export interface Profile {
  id: string;
  username: string;
}

/** The caller's own profile, or null when they have not set a username yet. */
export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username')
    .eq('id', userId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read profile: ${error.message}`);
  }

  return data === null ? null : { id: data.id, username: data.username };
}

/**
 * Create or change the caller's username. Upsert rather than insert-then-update
 * so first-time set and later rename are the same call.
 */
export async function setUsername(userId: string, username: string): Promise<Profile> {
  const parsed = usernameSchema.parse(username);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('profiles')
    .upsert({ id: userId, username: parsed, updated_at: new Date().toISOString() })
    .select('id, username')
    .single();

  if (error !== null) {
    // 23505 is the unique violation on profiles_username_lower_idx — the
    // case-insensitive collision, surfaced as a typed error the form can show
    // against the field rather than a raw Postgres message.
    if (error.code === '23505') {
      throw new UsernameTakenError(parsed);
    }

    throw new Error(`Failed to set username: ${error.message}`);
  }

  return { id: data.id, username: data.username };
}

/**
 * Resolve many user ids to display names at once. Ids with no profile are
 * simply absent from the map — callers fall back to something short rather
 * than rendering a bare uuid.
 */
export async function getUsernames(userIds: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];

  if (unique.length === 0) {
    return new Map();
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from('profiles').select('id, username').in('id', unique);

  if (error !== null) {
    throw new Error(`Failed to resolve usernames: ${error.message}`);
  }

  return new Map(data.map((row) => [row.id, row.username]));
}

/**
 * What to show for a user with no username set. The uuid tail keeps two
 * unnamed members distinguishable without exposing the whole id.
 */
export function fallbackName(userId: string): string {
  return `Player ${userId.slice(0, 8)}`;
}
