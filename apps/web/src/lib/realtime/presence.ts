'use client';

import { useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';

/**
 * Realtime presence — advisory only. No turn-loop transition or generation
 * outcome may depend on this module; it only ever reads already-fetched data
 * (claimed entities, submissions) and Realtime's own ephemeral presence
 * state, never the reverse.
 */

export interface SubmissionCompleteness {
  /** Claimed entities with no submission yet for the open turn. */
  waitingOn: number;
  /** Claimed entities total (the denominator "waiting on N of M" needs). */
  totalClaimed: number;
}

/**
 * Pure: "waiting on N of M" counts claimed entities against submitted
 * entities, excluding unclaimed ones (an unclaimed entity is nobody's turn to
 * wait on).
 */
export function computeSubmissionCompleteness(
  claimedEntityIds: readonly string[],
  submittedEntityIds: readonly string[],
): SubmissionCompleteness {
  const submitted = new Set(submittedEntityIds);
  const waitingOn = claimedEntityIds.filter((id) => !submitted.has(id)).length;

  return { waitingOn, totalClaimed: claimedEntityIds.length };
}

export interface PresenceMember {
  userId: string;
}

/**
 * Story-level online presence. Returns an empty array (rather than throwing)
 * when Realtime is unavailable — presence is advisory, so a failed
 * subscription degrades to "nobody shown as online," never a crash.
 */
export function useStoryPresence(storyId: string, userId: string): PresenceMember[] {
  const [members, setMembers] = useState<PresenceMember[]>([]);

  useEffect(() => {
    let channel: ReturnType<ReturnType<typeof createClient>['channel']> | null = null;

    try {
      const supabase = createClient();
      channel = supabase.channel(`story:${storyId}:presence`, {
        config: { presence: { key: userId } },
      });

      channel
        .on('presence', { event: 'sync' }, () => {
          const state = channel?.presenceState() ?? {};
          setMembers(Object.keys(state).map((key) => ({ userId: key })));
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            void channel?.track({ online_at: new Date().toISOString() });
          }
        });
    } catch {
      // Realtime unavailable — presence stays empty, which is a valid state,
      // not an error state, for advisory-only UI.
      setMembers([]);
    }

    return () => {
      if (channel !== null) {
        void channel.unsubscribe();
      }
    };
  }, [storyId, userId]);

  return members;
}

/**
 * Per-turn submission-completeness, updated live as submissions arrive.
 * `claimedEntityIds` is supplied by the caller (already fetched server-side)
 * rather than queried here, so this hook has no data-fetching responsibility
 * beyond listening for change.
 */
export function useTurnPresence(
  storyId: string,
  turnId: string | null,
  claimedEntityIds: readonly string[],
  initialSubmittedEntityIds: readonly string[],
): SubmissionCompleteness {
  const [submittedEntityIds, setSubmittedEntityIds] = useState<readonly string[]>(
    initialSubmittedEntityIds,
  );

  // initialSubmittedEntityIds is recomputed (new array reference) on every
  // render of the caller, so it can't be a dependency directly — that would
  // re-run this effect, call setState, and re-render in an infinite loop.
  // Depend on its serialized contents instead, which is stable across
  // renders where the actual submitted ids haven't changed.
  const initialSubmittedEntityIdsKey = initialSubmittedEntityIds.join(',');

  useEffect(() => {
    setSubmittedEntityIds(initialSubmittedEntityIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSubmittedEntityIdsKey]);

  useEffect(() => {
    if (turnId === null) {
      return;
    }

    let channel: ReturnType<ReturnType<typeof createClient>['channel']> | null = null;

    try {
      const supabase = createClient();
      channel = supabase
        .channel(`story:${storyId}:turn:${turnId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'submissions', filter: `turn_id=eq.${turnId}` },
          (payload) => {
            const entityId = (payload.new as { entity_id: string | null }).entity_id;
            if (entityId !== null) {
              setSubmittedEntityIds((current) => [...current, entityId]);
            }
          },
        )
        .subscribe();
    } catch {
      // Realtime unavailable — the initial snapshot (from the server-rendered
      // fetch) still stands; it just won't update live.
    }

    return () => {
      if (channel !== null) {
        void channel.unsubscribe();
      }
    };
  }, [storyId, turnId]);

  return computeSubmissionCompleteness(claimedEntityIds, submittedEntityIds);
}
