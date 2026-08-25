import 'server-only';

import { assertMember, requireRole } from '@/lib/engine/membership';
import { createServiceRoleClient } from '@/lib/supabase/server';

/** Per-story reporting of a chapter or submission (build plan 7.5). */

export type ReportStatus = 'open' | 'resolved';

export interface Report {
  id: string;
  storyId: string;
  reporterId: string | null;
  chapterId: string | null;
  submissionId: string | null;
  reason: string;
  status: ReportStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface ReportRow {
  id: string;
  story_id: string;
  reporter_id: string | null;
  chapter_id: string | null;
  submission_id: string | null;
  reason: string;
  status: string;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

function toReport(row: ReportRow): Report {
  return {
    id: row.id,
    storyId: row.story_id,
    reporterId: row.reporter_id,
    chapterId: row.chapter_id,
    submissionId: row.submission_id,
    reason: row.reason,
    status: row.status as ReportStatus,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

const REPORT_COLUMNS =
  'id, story_id, reporter_id, chapter_id, submission_id, reason, status, resolved_by, resolved_at, created_at';

async function insertReport(
  storyId: string,
  userId: string,
  target: { chapterId: string | null; submissionId: string | null },
  reason: string,
): Promise<Report> {
  await assertMember(storyId, userId);

  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) {
    throw new Error('A report reason is required.');
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('story_reports')
    .insert({
      story_id: storyId,
      reporter_id: userId,
      chapter_id: target.chapterId,
      submission_id: target.submissionId,
      reason: trimmedReason,
    })
    .select(REPORT_COLUMNS)
    .single();

  if (error !== null) {
    throw new Error(`Failed to file report: ${error.message}`);
  }

  return toReport(data);
}

export class ChapterNotFoundError extends Error {
  constructor(readonly chapterId: string) {
    super(`Chapter ${chapterId} not found.`);
    this.name = 'ChapterNotFoundError';
  }
}

export class SubmissionNotFoundError extends Error {
  constructor(readonly submissionId: string) {
    super(`Submission ${submissionId} not found.`);
    this.name = 'SubmissionNotFoundError';
  }
}

export async function reportChapter(chapterId: string, userId: string, reason: string): Promise<Report> {
  const supabase = createServiceRoleClient();
  const { data: chapter, error } = await supabase
    .from('chapters')
    .select('story_id')
    .eq('id', chapterId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read chapter: ${error.message}`);
  }

  if (chapter === null) {
    throw new ChapterNotFoundError(chapterId);
  }

  return insertReport(chapter.story_id, userId, { chapterId, submissionId: null }, reason);
}

export async function reportSubmission(
  submissionId: string,
  userId: string,
  reason: string,
): Promise<Report> {
  const supabase = createServiceRoleClient();
  const { data: submission, error } = await supabase
    .from('submissions')
    .select('story_id')
    .eq('id', submissionId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to read submission: ${error.message}`);
  }

  if (submission === null) {
    throw new SubmissionNotFoundError(submissionId);
  }

  return insertReport(submission.story_id, userId, { chapterId: null, submissionId }, reason);
}

/** Owner/GM only. */
export async function listReports(storyId: string, userId: string): Promise<Report[]> {
  await requireRole(storyId, userId, ['owner', 'gm']);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('story_reports')
    .select(REPORT_COLUMNS)
    .eq('story_id', storyId)
    .order('created_at', { ascending: false });

  if (error !== null) {
    throw new Error(`Failed to list reports: ${error.message}`);
  }

  return data.map(toReport);
}

export class ReportNotFoundError extends Error {
  constructor(readonly reportId: string) {
    super(`Report ${reportId} not found.`);
    this.name = 'ReportNotFoundError';
  }
}

/** Owner/GM only. Marks a report resolved without altering its original fields. */
export async function resolveReport(reportId: string, userId: string): Promise<Report> {
  const supabase = createServiceRoleClient();

  const { data: existing, error: readError } = await supabase
    .from('story_reports')
    .select('story_id')
    .eq('id', reportId)
    .maybeSingle();

  if (readError !== null) {
    throw new Error(`Failed to read report: ${readError.message}`);
  }

  if (existing === null) {
    throw new ReportNotFoundError(reportId);
  }

  await requireRole(existing.story_id, userId, ['owner', 'gm']);

  const { data, error } = await supabase
    .from('story_reports')
    .update({ status: 'resolved', resolved_by: userId, resolved_at: new Date().toISOString() })
    .eq('id', reportId)
    .select(REPORT_COLUMNS)
    .single();

  if (error !== null) {
    throw new Error(`Failed to resolve report: ${error.message}`);
  }

  return toReport(data);
}
