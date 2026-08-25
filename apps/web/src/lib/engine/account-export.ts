import 'server-only';

import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Self-serve account data export (launch plan C1.2, alongside account-deletion.ts).
 *
 * Follows the same boundary account-deletion.ts already draws: what belongs
 * to this user personally (profile, preferences, their own submissions,
 * reports they filed, their usage history, key metadata) versus what belongs
 * to a story (chapters, other members' data) — the latter is never included,
 * the same way deleting an account never deletes a story.
 *
 * Small, synchronous, JSON only — unlike export.ts's requestExport (story
 * prose rendered to Markdown/PDF/EPUB, storage-bucket-backed, job-tracked),
 * this is a handful of already-small rows with no rendering step, so there is
 * no async job to track.
 */

export interface AccountExport {
  exportedAt: string;
  userId: string;
  profile: { username: string } | null;
  preferences: {
    themePreset: string;
    accentHue: number;
    fontPairing: string;
    textScale: number;
  } | null;
  storyMemberships: {
    storyId: string;
    storyTitle: string;
    role: string;
    joinedAt: string;
  }[];
  submissions: {
    id: string;
    storyId: string;
    turnId: string;
    content: string;
    submittedAt: string;
  }[];
  reportsFiled: {
    id: string;
    storyId: string;
    chapterId: string | null;
    submissionId: string | null;
    reason: string;
    status: string;
    createdAt: string;
  }[];
  usageHistory: {
    storyId: string | null;
    role: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    succeeded: boolean;
    createdAt: string;
  }[];
  apiKeys: {
    scope: string;
    storyId: string | null;
    label: string | null;
    createdAt: string;
  }[];
}

export async function requestAccountExport(userId: string): Promise<AccountExport> {
  const supabase = createServiceRoleClient();

  const [profileResult, preferencesResult, membershipResult, submissionsResult, reportsResult, usageResult, apiKeysResult] =
    await Promise.all([
      supabase.from('profiles').select('username').eq('id', userId).maybeSingle(),
      supabase
        .from('user_preferences')
        .select('theme_preset, accent_hue, font_pairing, text_scale')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('story_members')
        .select('story_id, role, joined_at, stories(title)')
        .eq('user_id', userId),
      supabase
        .from('submissions')
        .select('id, story_id, turn_id, content, submitted_at')
        .eq('user_id', userId),
      supabase
        .from('story_reports')
        .select('id, story_id, chapter_id, submission_id, reason, status, created_at')
        .eq('reporter_id', userId),
      supabase
        .from('usage_log')
        .select('story_id, role, model, prompt_tokens, completion_tokens, cost_usd, succeeded, created_at')
        .eq('user_id', userId),
      supabase
        .from('api_keys')
        .select('scope, story_id, label, created_at')
        .eq('owner_id', userId),
    ]);

  for (const result of [
    profileResult,
    preferencesResult,
    membershipResult,
    submissionsResult,
    reportsResult,
    usageResult,
    apiKeysResult,
  ]) {
    if (result.error !== null) {
      throw new Error(`Failed to build account export: ${result.error.message}`);
    }
  }

  return {
    exportedAt: new Date().toISOString(),
    userId,
    profile: profileResult.data !== null ? { username: profileResult.data.username } : null,
    preferences:
      preferencesResult.data !== null
        ? {
            themePreset: preferencesResult.data.theme_preset,
            accentHue: preferencesResult.data.accent_hue,
            fontPairing: preferencesResult.data.font_pairing,
            textScale: preferencesResult.data.text_scale,
          }
        : null,
    storyMemberships: (membershipResult.data ?? []).map((row) => ({
      storyId: row.story_id,
      storyTitle: (row.stories as unknown as { title: string } | null)?.title ?? '(deleted story)',
      role: row.role,
      joinedAt: row.joined_at,
    })),
    submissions: (submissionsResult.data ?? []).map((row) => ({
      id: row.id,
      storyId: row.story_id,
      turnId: row.turn_id,
      content: row.content,
      submittedAt: row.submitted_at,
    })),
    reportsFiled: (reportsResult.data ?? []).map((row) => ({
      id: row.id,
      storyId: row.story_id,
      chapterId: row.chapter_id,
      submissionId: row.submission_id,
      reason: row.reason,
      status: row.status,
      createdAt: row.created_at,
    })),
    usageHistory: (usageResult.data ?? []).map((row) => ({
      storyId: row.story_id,
      role: row.role,
      model: row.model,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      costUsd: row.cost_usd,
      succeeded: row.succeeded,
      createdAt: row.created_at,
    })),
    apiKeys: (apiKeysResult.data ?? []).map((row) => ({
      scope: row.scope,
      storyId: row.story_id,
      label: row.label,
      createdAt: row.created_at,
    })),
  };
}
