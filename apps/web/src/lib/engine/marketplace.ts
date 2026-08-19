import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Universe marketplace (Phase 8 — universe-marketplace capability).
 *
 * Both operations run under the caller's own session, not service-role:
 * `listPublicUniverses` relies on `universes_select`'s widened RLS policy
 * (migration 20260823000002) to filter to `is_public` rows automatically,
 * and `cloneUniverse` calls `clone_universe`, which reads no session state
 * itself but is only granted to `authenticated` — matching `search_story`'s
 * and `resolve_share_link`'s pattern of keeping the authorization boundary
 * in the database rather than duplicating it here.
 */

export interface PublicUniverseSummary {
  id: string;
  name: string;
  ownerId: string;
  forkedFrom: string | null;
  createdAt: string;
}

interface UniverseRow {
  id: string;
  name: string;
  owner_id: string;
  forked_from: string | null;
  created_at: string;
}

function toSummary(row: UniverseRow): PublicUniverseSummary {
  return { id: row.id, name: row.name, ownerId: row.owner_id, forkedFrom: row.forked_from, createdAt: row.created_at };
}

/** Any authenticated user. Relies on RLS to scope results to is_public rows. */
export async function listPublicUniverses(): Promise<PublicUniverseSummary[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('universes')
    .select('id, name, owner_id, forked_from, created_at')
    .eq('is_public', true)
    .order('created_at', { ascending: false });

  if (error !== null) {
    throw new Error(`Failed to list public universes: ${error.message}`);
  }

  return data.map(toSummary);
}

export interface ClonedUniverseVersion {
  universeId: string;
  version: number;
}

/**
 * Clones a public (or caller-owned) universe's latest version into a new,
 * independently-owned universe at version 1. The `clone_universe` SQL
 * function enforces "must be public or owned by the caller" itself, so this
 * is a thin wrapper, not a second authorization check.
 */
export async function cloneUniverse(universeId: string, userId: string): Promise<ClonedUniverseVersion> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('clone_universe', {
    p_universe_id: universeId,
    p_owner_id: userId,
  });

  if (error !== null) {
    throw new Error(`Failed to clone universe: ${error.message}`);
  }

  return { universeId: data.universe_id, version: data.version };
}
