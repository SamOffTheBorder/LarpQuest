import 'server-only';

import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import { requireRole } from '@/lib/engine/membership';
import { getUsernames } from '@/lib/engine/profiles';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Invite links — the only path onto a story besides being its creator.
 *
 * A token is a durable, revocable row rather than a signed JWT: revocation
 * (build plan 7.5) needs something that can be invalidated without a
 * blocklist, and a row is the same choice the rest of this schema makes for
 * every other grant.
 */

const DEFAULT_EXPIRY_DAYS = 7;

export const inviteRoleSchema = z.enum(['gm', 'player', 'spectator']);
export type InviteRole = z.infer<typeof inviteRoleSchema>;

export const createInviteInputSchema = z.object({
  role: inviteRoleSchema,
  expiresInDays: z.number().positive().default(DEFAULT_EXPIRY_DAYS),
  maxUses: z.number().int().positive().nullable().default(null),
});

export type CreateInviteInput = z.infer<typeof createInviteInputSchema>;

/** Someone who joined through a given invite. */
export interface InviteJoiner {
  userId: string;
  username: string | null;
}

export interface Invite {
  id: string;
  storyId: string;
  token: string;
  role: InviteRole;
  expiresAt: string;
  revokedAt: string | null;
  maxUses: number | null;
  useCount: number;
  /** Populated by listInvites; empty elsewhere. */
  joiners: InviteJoiner[];
}

interface InviteRow {
  id: string;
  story_id: string;
  token: string;
  role: string;
  expires_at: string;
  revoked_at: string | null;
  max_uses: number | null;
  use_count: number;
}

function toInvite(row: InviteRow): Invite {
  return {
    id: row.id,
    storyId: row.story_id,
    token: row.token,
    role: row.role as InviteRole,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    maxUses: row.max_uses,
    useCount: row.use_count,
    joiners: [],
  };
}

const INVITE_COLUMNS = 'id, story_id, token, role, expires_at, revoked_at, max_uses, use_count';

export class InviteNotFoundError extends Error {
  constructor(readonly inviteId: string) {
    super(`Invite ${inviteId} not found.`);
    this.name = 'InviteNotFoundError';
  }
}

/**
 * Owner or GM only. Revoked invites are excluded: a revoked link is not an
 * actionable row — it cannot be copied or revoked again — so it is noise on
 * the members page. The row itself is deliberately kept (revocation is an
 * update, not a delete) so members admitted through it keep their attribution.
 */
export async function listInvites(storyId: string, userId: string): Promise<Invite[]> {
  await requireRole(storyId, userId, ['owner', 'gm']);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('story_invites')
    .select(INVITE_COLUMNS)
    .eq('story_id', storyId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  if (error !== null) {
    throw new Error(`Failed to list invites: ${error.message}`);
  }

  const invites = data.map(toInvite);

  // Who came in through each link. One read for the whole story rather than
  // one per invite, then grouped in memory.
  const { data: members, error: memberError } = await supabase
    .from('story_members')
    .select('user_id, joined_via_invite')
    .eq('story_id', storyId)
    .not('joined_via_invite', 'is', null);

  if (memberError !== null) {
    throw new Error(`Failed to resolve invite usage: ${memberError.message}`);
  }

  const usernames = await getUsernames(members.map((row) => row.user_id));
  const byInvite = new Map<string, InviteJoiner[]>();

  for (const row of members) {
    const inviteId = row.joined_via_invite;
    if (inviteId === null) {
      continue;
    }

    const list = byInvite.get(inviteId) ?? [];
    list.push({ userId: row.user_id, username: usernames.get(row.user_id) ?? null });
    byInvite.set(inviteId, list);
  }

  return invites.map((invite) => ({ ...invite, joiners: byInvite.get(invite.id) ?? [] }));
}

/** Owner or GM only. Ownership is never grantable via invite. */
export async function createInvite(
  storyId: string,
  userId: string,
  input: CreateInviteInput,
): Promise<Invite> {
  await requireRole(storyId, userId, ['owner', 'gm']);

  const parsed = createInviteInputSchema.parse(input);
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + parsed.expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('story_invites')
    .insert({
      story_id: storyId,
      token,
      role: parsed.role,
      created_by: userId,
      expires_at: expiresAt,
      max_uses: parsed.maxUses,
    })
    .select(INVITE_COLUMNS)
    .single();

  if (error !== null) {
    throw new Error(`Failed to create invite: ${error.message}`);
  }

  return toInvite(data);
}

/** Owner or GM only. Revocation blocks future joins; existing members stay. */
export async function revokeInvite(inviteId: string, userId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: existing, error: readError } = await supabase
    .from('story_invites')
    .select('story_id')
    .eq('id', inviteId)
    .maybeSingle();

  if (readError !== null) {
    throw new Error(`Failed to read invite: ${readError.message}`);
  }

  if (existing === null) {
    throw new InviteNotFoundError(inviteId);
  }

  await requireRole(existing.story_id, userId, ['owner', 'gm']);

  const { error } = await supabase
    .from('story_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', inviteId);

  if (error !== null) {
    throw new Error(`Failed to revoke invite: ${error.message}`);
  }
}

export class InvalidInviteError extends Error {
  constructor(readonly reason: 'invite_not_found' | 'invite_revoked' | 'invite_expired' | 'invite_exhausted') {
    super(`Invite is invalid: ${reason}.`);
    this.name = 'InvalidInviteError';
  }
}

const INVITE_ERROR_REASONS = new Set(['invite_not_found', 'invite_revoked', 'invite_expired', 'invite_exhausted']);

export interface JoinResult {
  storyId: string;
  role: InviteRole;
}

/**
 * Join a story via an invite token. Delegates to join_story_via_invite, which
 * validates the token and inserts the membership row atomically — no window
 * where a client could act on a token it read moments earlier as still valid.
 *
 * Must run under the caller's own session (the RPC reads auth.uid()), never
 * the service-role client — service-role calls carry no user session, so
 * auth.uid() would resolve to null inside the function.
 */
export async function joinViaInvite(token: string): Promise<JoinResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('join_story_via_invite', { p_token: token });

  if (error !== null) {
    const reason = [...INVITE_ERROR_REASONS].find((candidate) => error.message.includes(candidate));

    if (reason !== undefined) {
      throw new InvalidInviteError(reason as InvalidInviteError['reason']);
    }

    throw new Error(`Failed to join story: ${error.message}`);
  }

  // The RPC returns both role and story_id directly (it's security definer,
  // so it can read story_invites regardless of the caller's role) — a
  // follow-up client-session query against story_invites would be blocked by
  // story_invites_select for anyone joining as player/spectator, since that
  // policy only allows owner/gm to read.
  const row = (Array.isArray(data) ? data[0] : data) as { role: InviteRole; story_id: string } | undefined;

  if (row === undefined) {
    throw new Error('Joined successfully but the story could not be resolved.');
  }

  return { storyId: row.story_id, role: row.role };
}
