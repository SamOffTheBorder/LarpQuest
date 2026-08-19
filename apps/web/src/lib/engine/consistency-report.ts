import 'server-only';

import { assertMember } from '@/lib/engine/membership';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Read-only consistency report (consistency-report capability): a chapter's
 * validation flags and a story's proposal history. RLS already restricts
 * both `chapters` and `proposals` to story members, so these are plain reads
 * with an application-level membership check for a consistent error shape —
 * no server-side role filtering, since every member sees identical content
 * here (the override action, not the report itself, is where owner/gm gets
 * more than a player).
 */

export type Severity = 'block' | 'warn' | 'log';

export interface ValidationFlag {
  ruleId: string;
  severity: Severity;
  description: string;
  entityId: string | null;
  capabilityId: string | null;
}

export interface ChapterValidationReport {
  chapterId: string;
  turnNumber: number;
  /** Empty means "evaluated, no issues" — distinct from a chapter published
   * before this phase, which has no report at all (see below). */
  flags: ValidationFlag[];
  /** False for a chapter published before Phase 6 — its validation_report
   * column was never populated, so there is nothing to distinguish "clean"
   * from "not yet evaluated" without this flag. */
  evaluated: boolean;
}

export class ChapterNotFoundError extends Error {
  constructor(readonly chapterId: string) {
    super(`Chapter ${chapterId} not found.`);
    this.name = 'ChapterNotFoundError';
  }
}

function parseFlags(value: unknown): ValidationFlag[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => ({
      ruleId: String(entry.rule_id ?? ''),
      severity: (entry.severity as Severity | undefined) ?? 'log',
      description: String(entry.description ?? ''),
      entityId: typeof entry.entity_id === 'string' ? entry.entity_id : null,
      capabilityId: typeof entry.capability_id === 'string' ? entry.capability_id : null,
    }));
}

export async function getChapterValidationReport(
  chapterId: string,
  userId: string,
): Promise<ChapterValidationReport> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('chapters')
    .select('id, story_id, turn_number, validation_report')
    .eq('id', chapterId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read chapter: ${error.message}`);
  }

  if (data === null) {
    throw new ChapterNotFoundError(chapterId);
  }

  await assertMember(data.story_id, userId);

  return {
    chapterId: data.id,
    turnNumber: data.turn_number,
    flags: parseFlags(data.validation_report),
    evaluated: data.validation_report !== null,
  };
}

export interface ProposalHistoryEntry {
  id: string;
  entityId: string | null;
  proposal: string;
  verdict: 'allow' | 'allow_with_limits' | 'reject' | null;
  reasoning: string | null;
  gmOverride: boolean;
  createdAt: string;
}

export async function getStoryProposalHistory(
  storyId: string,
  userId: string,
): Promise<ProposalHistoryEntry[]> {
  await assertMember(storyId, userId);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('proposals')
    .select('id, entity_id, proposal, verdict, reasoning, gm_override, created_at')
    .eq('story_id', storyId)
    .order('created_at', { ascending: false });

  if (error !== null) {
    throw new Error(`Failed to list proposals: ${error.message}`);
  }

  return data.map((row) => ({
    id: row.id,
    entityId: row.entity_id,
    proposal: row.proposal,
    verdict: row.verdict as ProposalHistoryEntry['verdict'],
    reasoning: row.reasoning,
    gmOverride: row.gm_override,
    createdAt: row.created_at,
  }));
}
