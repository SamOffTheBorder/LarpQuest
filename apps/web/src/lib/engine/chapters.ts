import 'server-only';

import { assertMember, isOwner } from '@/lib/engine/membership';
import { createServiceRoleClient } from '@/lib/supabase/server';

export interface Chapter {
  id: string;
  turnNumber: number;
  turnMode: string;
  prose: string;
  publishedAt: string;
  extractionStatus: string;
  rolledBackAt: string | null;
}

interface ChapterRow {
  id: string;
  turn_number: number;
  turn_mode: string;
  prose: string;
  published_at: string;
  extraction_status: string;
  rolled_back_at: string | null;
}

function toChapter(row: ChapterRow): Chapter {
  return {
    id: row.id,
    turnNumber: row.turn_number,
    turnMode: row.turn_mode,
    prose: row.prose,
    publishedAt: row.published_at,
    extractionStatus: row.extraction_status,
    rolledBackAt: row.rolled_back_at,
  };
}

export interface RollbackConflict {
  entityId: string;
  field: string;
}

export interface RollbackResult {
  reversedCount: number;
  conflicts: RollbackConflict[];
}

export class ChapterNotFoundError extends Error {
  constructor(readonly chapterId: string) {
    super(`Chapter ${chapterId} not found.`);
    this.name = 'ChapterNotFoundError';
  }
}

export class AlreadyRolledBackError extends Error {
  constructor(readonly chapterId: string) {
    super(`Chapter ${chapterId} was already rolled back.`);
    this.name = 'AlreadyRolledBackError';
  }
}

/** Chapters in chronological order. */
export async function listChapters(storyId: string, userId: string): Promise<Chapter[]> {
  await assertMember(storyId, userId);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('chapters')
    .select('id, turn_number, turn_mode, prose, published_at, extraction_status, rolled_back_at')
    .eq('story_id', storyId)
    .order('turn_number', { ascending: true });

  if (error !== null) {
    throw new Error(`Failed to list chapters: ${error.message}`);
  }

  return data.map(toChapter);
}

/**
 * Reverse a chapter's entity effects. The chapter itself stays visible —
 * only its entity_history rows are reversed, via compensating rows written by
 * the `rollback_chapter` database function. A field a later change has since
 * touched is reported as a conflict rather than overwritten.
 */
export async function rollbackChapter(
  chapterId: string,
  userId: string,
  storyId: string,
): Promise<RollbackResult> {
  if (!(await isOwner(storyId, userId))) {
    throw new ChapterNotFoundError(chapterId);
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('rollback_chapter', {
    p_chapter_id: chapterId,
    p_user_id: userId,
  });

  if (error !== null) {
    if (error.message.includes('already been rolled back') || error.message.includes('already rolled back')) {
      throw new AlreadyRolledBackError(chapterId);
    }
    if (error.code === 'PGRST116' || error.message.includes('not found')) {
      throw new ChapterNotFoundError(chapterId);
    }
    throw new Error(`Failed to roll back chapter: ${error.message}`);
  }

  const rows = data ?? [];

  return {
    reversedCount: rows.filter((row) => row.outcome === 'reversed').length,
    conflicts: rows
      .filter((row) => row.outcome === 'conflict')
      .map((row) => ({ entityId: row.entity_id, field: row.field })),
  };
}
