import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Full-text search (Phase 8 — full-text-search capability).
 *
 * A separate, user-facing keyword surface built on Postgres tsvector/GIN —
 * it does not read or reuse Phase 4's embedding columns, which serve context
 * assembly instead. Membership is checked inside `search_story` itself
 * (security definer, reading `auth.uid()`) — this must run under the
 * caller's own session, never the service-role client, exactly like
 * `invites.ts`'s `joinViaInvite`: a service-role call carries no user
 * session, so `auth.uid()` would resolve to null and `is_story_member`
 * would always reject.
 */

export interface SearchResult {
  kind: 'chapter' | 'entity';
  id: string;
  title: string;
  snippet: string;
  rank: number;
}

interface SearchStoryRow {
  kind: string;
  id: string;
  title: string;
  snippet: string;
  rank: number;
}

/**
 * Search a story's chapters and entities. Membership is enforced by
 * `search_story`'s own internal `is_story_member` check against the caller's
 * session — a non-member call raises, which surfaces here as a thrown error
 * rather than an empty result, so a caller can distinguish "no matches" from
 * "not allowed to search this story."
 */
export async function searchStory(storyId: string, query: string): Promise<SearchResult[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('search_story', { p_story_id: storyId, p_query: query });

  if (error !== null) {
    throw new Error(`Search failed: ${error.message}`);
  }

  return (data as SearchStoryRow[]).map((row) => ({
    kind: row.kind as SearchResult['kind'],
    id: row.id,
    title: row.title,
    snippet: row.snippet,
    rank: row.rank,
  }));
}
