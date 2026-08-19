import 'server-only';

import { randomBytes } from 'node:crypto';

import { requireRole } from '@/lib/engine/membership';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Public read-only share links (Phase 8 — share-links capability).
 *
 * The one capability in this phase with no anonymous-read RLS policy — a
 * share-link visitor is not a story_members row, so `resolve_share_link`
 * (security definer, granted to anon — migration 20260823000005) is the
 * authorization boundary, the same pre-membership pattern
 * `invites.ts`'s `joinViaInvite` already established for a token-bearing
 * non-member. Revocation is an update (revoked_at), never a delete, so a
 * link's history stays intact.
 */

const SIGNED_URL_TTL_SECONDS = 300;

export interface ShareLinkRecord {
  id: string;
  storyId: string;
  token: string;
  createdBy: string | null;
  revokedAt: string | null;
}

interface ShareLinkRow {
  id: string;
  story_id: string;
  token: string;
  created_by: string | null;
  revoked_at: string | null;
}

function toShareLinkRecord(row: ShareLinkRow): ShareLinkRecord {
  return {
    id: row.id,
    storyId: row.story_id,
    token: row.token,
    createdBy: row.created_by,
    revokedAt: row.revoked_at,
  };
}

const SHARE_LINK_COLUMNS = 'id, story_id, token, created_by, revoked_at';

/** Owner/GM only. */
export async function createShareLink(storyId: string, userId: string): Promise<ShareLinkRecord> {
  await requireRole(storyId, userId, ['owner', 'gm']);

  const supabase = createServiceRoleClient();
  const token = randomBytes(24).toString('base64url');

  const { data, error } = await supabase
    .from('share_links')
    .insert({ story_id: storyId, token, created_by: userId })
    .select(SHARE_LINK_COLUMNS)
    .single();

  if (error !== null) {
    throw new Error(`Failed to create share link: ${error.message}`);
  }

  return toShareLinkRecord(data);
}

/** Owner/GM only. Revocation is an update, not a delete — the link's history is kept. */
export async function revokeShareLink(shareLinkId: string, userId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: link, error: readError } = await supabase
    .from('share_links')
    .select('story_id')
    .eq('id', shareLinkId)
    .single();

  if (readError !== null) {
    throw new Error(`Failed to read share link: ${readError.message}`);
  }

  await requireRole(link.story_id, userId, ['owner', 'gm']);

  const { error: updateError } = await supabase
    .from('share_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', shareLinkId);

  if (updateError !== null) {
    throw new Error(`Failed to revoke share link: ${updateError.message}`);
  }
}

/**
 * Resolves a token to its story id via the `resolve_share_link` RPC, which
 * returns null for an invalid or revoked token rather than raising — a
 * route can render "not found" without needing to distinguish the two.
 */
export async function resolveShareLink(token: string): Promise<string | null> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase.rpc('resolve_share_link', { p_token: token });

  if (error !== null) {
    throw new Error(`Failed to resolve share link: ${error.message}`);
  }

  return data;
}

export interface SharedChapterView {
  turnNumber: number;
  prose: string;
  imageUrls: string[];
  videoUrls: string[];
}

export interface SharedStoryView {
  title: string;
  chapters: SharedChapterView[];
}

/**
 * The full read-only view for a share-link visitor: published (non-rolled-
 * back) chapters only, no entity sheets, no turn/submission data, plus
 * short-expiry signed URLs for each chapter's complete images/videos. The
 * short TTL bounds how long a *previously issued* URL keeps working after
 * revocation — a signed URL is a self-contained credential, so revoking the
 * share_links row cannot invalidate one already handed to a visitor's
 * browser, but it does stop `getSharedStoryView` (gated by
 * `resolveShareLink` above) from ever issuing a new one once revoked_at is
 * set, and bounds the exposure window of any URL issued before that to
 * SIGNED_URL_TTL_SECONDS.
 */
export async function getSharedStoryView(token: string): Promise<SharedStoryView | null> {
  const storyId = await resolveShareLink(token);

  if (storyId === null) {
    return null;
  }

  const supabase = createServiceRoleClient();

  const [storyResult, chaptersResult] = await Promise.all([
    supabase.from('stories').select('title').eq('id', storyId).single(),
    supabase
      .from('chapters')
      .select('id, turn_number, prose, rolled_back_at')
      .eq('story_id', storyId)
      .is('rolled_back_at', null)
      .order('turn_number', { ascending: true }),
  ]);

  if (storyResult.error !== null) {
    throw new Error(`Failed to read story: ${storyResult.error.message}`);
  }
  if (chaptersResult.error !== null) {
    throw new Error(`Failed to read chapters: ${chaptersResult.error.message}`);
  }

  const chapterIds = chaptersResult.data.map((chapter) => chapter.id);

  // One IN-query per media table (not one per chapter) plus one batched
  // sign call per table (not one per file) — a 30-chapter story with media
  // on every chapter would otherwise be well over a hundred sequential
  // round-trips on this route's one anonymous, public request path.
  const [imagesResult, videosResult] = await Promise.all([
    supabase.from('chapter_images').select('chapter_id, storage_path').in('chapter_id', chapterIds).eq('status', 'complete'),
    supabase.from('chapter_videos').select('chapter_id, storage_path').in('chapter_id', chapterIds).eq('status', 'complete'),
  ]);

  if (imagesResult.error !== null) {
    throw new Error(`Failed to read chapter images: ${imagesResult.error.message}`);
  }
  if (videosResult.error !== null) {
    throw new Error(`Failed to read chapter videos: ${videosResult.error.message}`);
  }

  const [imageUrlsByChapter, videoUrlsByChapter] = await Promise.all([
    signAllGrouped(supabase, 'chapter-images', imagesResult.data),
    signAllGrouped(supabase, 'chapter-videos', videosResult.data),
  ]);

  const chapters: SharedChapterView[] = chaptersResult.data.map((chapter) => ({
    turnNumber: chapter.turn_number,
    prose: chapter.prose,
    imageUrls: imageUrlsByChapter.get(chapter.id) ?? [],
    videoUrls: videoUrlsByChapter.get(chapter.id) ?? [],
  }));

  return { title: storyResult.data.title, chapters };
}

/**
 * Signs every row's storage_path in one batched `createSignedUrls` call
 * (rather than one `createSignedUrl` call per row) and groups the results
 * back by chapter_id.
 */
async function signAllGrouped(
  supabase: ReturnType<typeof createServiceRoleClient>,
  bucket: string,
  rows: { chapter_id: string; storage_path: string | null }[],
): Promise<Map<string, string[]>> {
  const byChapter = new Map<string, string[]>();
  const signable = rows.filter((row): row is { chapter_id: string; storage_path: string } => row.storage_path !== null);

  if (signable.length === 0) {
    return byChapter;
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(
      signable.map((row) => row.storage_path),
      SIGNED_URL_TTL_SECONDS,
    );

  if (error !== null || data === null) {
    return byChapter;
  }

  signable.forEach((row, index) => {
    const signedUrl = data[index]?.signedUrl;
    if (signedUrl === undefined || signedUrl === null) return;

    const existing = byChapter.get(row.chapter_id) ?? [];
    existing.push(signedUrl);
    byChapter.set(row.chapter_id, existing);
  });

  return byChapter;
}
