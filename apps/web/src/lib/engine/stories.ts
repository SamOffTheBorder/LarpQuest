import 'server-only';

import { z } from 'zod';

import { defaultModelConfig, modelConfigSchema, type ModelConfig } from '@/lib/ai/roles';
import { CONTENT_RATINGS } from '@/lib/engine/content-ratings';
import { isMember, isOwner, requireRole, InsufficientRoleError } from '@/lib/engine/membership';
import { getLatestUniverseVersion } from '@/lib/engine/universes';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { toJson } from '@/lib/supabase/json';

/**
 * Story lifecycle: creation, listing, archive/restore.
 *
 * Creation writes the story and the owner's membership row atomically via
 * `create_story` — see story-lifecycle spec, "Membership insert fails".
 *
 * A story may optionally pin a universe version at creation (Phase 2). The
 * pin is resolved to the universe's latest published version once, at
 * creation time, and never moves on its own afterward — see
 * universe-versioning spec, "Universe gains a new version after a story has
 * pinned an earlier one".
 */

export { CONTENT_RATINGS };

export const createStoryInputSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(200, 'Title is too long.'),
  contentRating: z.enum(CONTENT_RATINGS),
  universeId: z.string().uuid().nullable().default(null),
});

export type CreateStoryInput = z.infer<typeof createStoryInputSchema>;

export interface StorySummary {
  id: string;
  title: string;
  status: string;
  currentTurn: number;
  updatedAt: string;
}

export interface Story extends StorySummary {
  contentRating: string;
  worldLedger: Record<string, unknown>;
  modelConfig: ModelConfig;
  universeId: string | null;
  universeVersion: number | null;
}

interface StoryRow {
  id: string;
  title: string;
  status: string;
  current_turn: number;
  updated_at: string;
  content_rating: string;
  world_ledger: unknown;
  model_config: unknown;
  universe_id: string | null;
  universe_version: number | null;
}

function toStorySummary(row: {
  id: string;
  title: string;
  status: string;
  current_turn: number;
  updated_at: string;
}): StorySummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    currentTurn: row.current_turn,
    updatedAt: row.updated_at,
  };
}

function toStory(row: StoryRow): Story {
  // model_config is written by createStory/updateStoryModelConfig, both of
  // which parse through modelConfigSchema first, so this is a safe cast, not
  // an assertion about untrusted input.
  return {
    ...toStorySummary(row),
    contentRating: row.content_rating,
    worldLedger: (row.world_ledger ?? {}) as Record<string, unknown>,
    modelConfig: (row.model_config ?? {}) as ModelConfig,
    universeId: row.universe_id,
    universeVersion: row.universe_version,
  };
}

const STORY_COLUMNS =
  'id, title, status, current_turn, updated_at, content_rating, world_ledger, model_config, universe_id, universe_version';

/** List stories the user belongs to, most recently active first. */
export async function listStories(userId: string): Promise<StorySummary[]> {
  const supabase = createServiceRoleClient();

  const { data: memberships, error: memberError } = await supabase
    .from('story_members')
    .select('story_id')
    .eq('user_id', userId);

  if (memberError !== null) {
    throw new Error(`Failed to list memberships: ${memberError.message}`);
  }

  const storyIds = memberships.map((row) => row.story_id);

  if (storyIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('stories')
    .select('id, title, status, current_turn, updated_at')
    .in('id', storyIds)
    .order('updated_at', { ascending: false });

  if (error !== null) {
    throw new Error(`Failed to list stories: ${error.message}`);
  }

  return data.map(toStorySummary);
}

export class StoryNotFoundError extends Error {
  constructor(readonly storyId: string) {
    // A non-member and a nonexistent story must look identical to the caller.
    super(`Story ${storyId} not found.`);
    this.name = 'StoryNotFoundError';
  }
}

/** assertMember, translated to the not-found shape this module presents. */
async function requireMember(storyId: string, userId: string): Promise<void> {
  if (!(await isMember(storyId, userId))) {
    throw new StoryNotFoundError(storyId);
  }
}

export async function getStory(storyId: string, userId: string): Promise<Story> {
  await requireMember(storyId, userId);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('stories')
    .select(STORY_COLUMNS)
    .eq('id', storyId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read story: ${error.message}`);
  }

  if (data === null) {
    throw new StoryNotFoundError(storyId);
  }

  return toStory(data);
}

/**
 * Owner or GM only. Replaces the story's model_config wholesale — the caller
 * is expected to have merged with the existing config first if it wants a
 * partial update, same as the underlying schema's semantics (absent roles
 * fall back to DEFAULT_MODELS, per story-lifecycle spec "Owner overrides a
 * role's model"). The GM is allowed here because they also supply the
 * OpenRouter key the chosen models run on (see ai-gateway).
 */
export async function updateStoryModelConfig(
  storyId: string,
  userId: string,
  modelConfig: ModelConfig,
): Promise<Story> {
  try {
    await requireRole(storyId, userId, ['owner', 'gm']);
  } catch (error) {
    if (error instanceof InsufficientRoleError) {
      throw new StoryNotFoundError(storyId);
    }
    throw error;
  }

  const parsed = modelConfigSchema.parse(modelConfig);
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from('stories')
    .update({ model_config: toJson(parsed) })
    .eq('id', storyId)
    .select(STORY_COLUMNS)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to update model config: ${error.message}`);
  }

  if (data === null) {
    throw new StoryNotFoundError(storyId);
  }

  return toStory(data);
}

/**
 * Create a story, seeding default model config and recording the owner.
 *
 * When `universeId` is given, the story pins the universe's latest published
 * version at creation time — resolved once, here, and never re-resolved
 * automatically afterward (see universe-versioning spec). There is no draft
 * state in this phase: a universe's first version is published the moment
 * it's created (design.md, Open Questions), so "latest published" is simply
 * the highest version that exists.
 */
export async function createStory(userId: string, input: CreateStoryInput): Promise<Story> {
  const parsed = createStoryInputSchema.parse(input);

  const pin =
    parsed.universeId !== null
      ? await getLatestUniverseVersion(parsed.universeId)
      : null;

  const supabase = createServiceRoleClient();

  const { data, error } = await supabase.rpc('create_story', {
    p_owner_id: userId,
    p_title: parsed.title,
    p_content_rating: parsed.contentRating,
    p_model_config: toJson(defaultModelConfig()),
    ...(pin !== null ? { p_universe_id: pin.universeId, p_universe_version: pin.version } : {}),
  });

  if (error !== null || data === null) {
    throw new Error(`Failed to create story: ${error?.message ?? 'no row returned'}`);
  }

  return toStory(data as unknown as StoryRow);
}

/**
 * Explicit, owner-initiated upgrade to a newer published universe version.
 * Never invoked implicitly — a story's pin otherwise never changes on its
 * own, per universe-versioning spec.
 */
export async function upgradeStoryUniverseVersion(
  storyId: string,
  userId: string,
  universeVersion: number,
): Promise<Story> {
  if (!(await isOwner(storyId, userId))) {
    throw new StoryNotFoundError(storyId);
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('upgrade_story_universe_version', {
    p_story_id: storyId,
    p_owner_id: userId,
    p_universe_version: universeVersion,
  });

  if (error !== null || data === null) {
    throw new Error(`Failed to upgrade universe version: ${error?.message ?? 'no row returned'}`);
  }

  return toStory(data as unknown as StoryRow);
}

/** Archive a story. Reversible; never touches chapters, entities, or history. */
export async function archiveStory(storyId: string, userId: string): Promise<Story> {
  return setStoryStatus(storyId, userId, 'archived');
}

/** Restore an archived story. Turn numbering continues from where it stopped. */
export async function restoreStory(storyId: string, userId: string): Promise<Story> {
  return setStoryStatus(storyId, userId, 'active');
}

/**
 * Permanently delete a story. Owner-only, irreversible.
 *
 * Relies on the stories table's foreign keys (chapters, entities,
 * story_members, entity_history, etc. all reference stories.id) to cascade —
 * see the migration that creates each dependent table for its `on delete`
 * behavior. This does not write an entity_history row itself: there is
 * nothing left to attach one to once the story row is gone.
 */
export async function deleteStory(storyId: string, userId: string): Promise<void> {
  if (!(await isOwner(storyId, userId))) {
    throw new StoryNotFoundError(storyId);
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('stories').delete().eq('id', storyId);

  if (error !== null) {
    throw new Error(`Failed to delete story: ${error.message}`);
  }
}

async function setStoryStatus(
  storyId: string,
  userId: string,
  status: 'active' | 'archived',
): Promise<Story> {
  // Owner-only per story-lifecycle spec, not just membership: archiving is
  // destructive to the story's day-to-day availability in a way a non-owning
  // member should not be able to trigger.
  if (!(await isOwner(storyId, userId))) {
    throw new StoryNotFoundError(storyId);
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('stories')
    .update({ status })
    .eq('id', storyId)
    .select(STORY_COLUMNS)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to update story status: ${error.message}`);
  }

  if (data === null) {
    throw new StoryNotFoundError(storyId);
  }

  return toStory(data);
}
