import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Handing a story's ownership to another member.
 *
 * Delegates to transfer_story_ownership, which demotes the outgoing owner to
 * `gm` (they keep meaningful access to the story they built, rather than
 * being reduced to a submitter) and promotes the target atomically. Must run
 * under the caller's own session — the RPC reads auth.uid() to identify the
 * outgoing owner, so the service-role client would resolve that to null.
 */

const TRANSFER_ERROR_REASONS = new Set(['not_owner', 'target_not_member', 'already_owner']);

export class InvalidTransferError extends Error {
  constructor(readonly reason: 'not_owner' | 'target_not_member' | 'already_owner') {
    super(`Cannot transfer ownership: ${reason}.`);
    this.name = 'InvalidTransferError';
  }
}

export async function transferStoryOwnership(storyId: string, newOwnerId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.rpc('transfer_story_ownership', {
    p_story_id: storyId,
    p_new_owner_id: newOwnerId,
  });

  if (error !== null) {
    const reason = [...TRANSFER_ERROR_REASONS].find((candidate) => error.message.includes(candidate));

    if (reason !== undefined) {
      throw new InvalidTransferError(reason as InvalidTransferError['reason']);
    }

    throw new Error(`Failed to transfer ownership: ${error.message}`);
  }
}
