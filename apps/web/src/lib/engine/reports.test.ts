import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  members: new Map<string, { role: string }>(),
  chapters: new Map<string, { story_id: string }>(),
  submissions: new Map<string, { story_id: string }>(),
  reports: [] as Record<string, unknown>[],
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => {
  function from(table: string) {
    const builder = {
      _filters: {} as Record<string, unknown>,
      _insertPayload: undefined as Record<string, unknown> | undefined,
      _updatePayload: undefined as Record<string, unknown> | undefined,
      select() {
        return builder;
      },
      order() {
        return builder;
      },
      eq(column: string, value: unknown) {
        builder._filters[column] = value;
        return builder;
      },
      insert(payload: Record<string, unknown>) {
        builder._insertPayload = payload;
        return builder;
      },
      update(payload: Record<string, unknown>) {
        builder._updatePayload = payload;
        return builder;
      },
      async single() {
        if (table === 'story_reports' && builder._insertPayload !== undefined) {
          const row = {
            id: `report-${state.reports.length + 1}`,
            status: 'open',
            resolved_by: null,
            resolved_at: null,
            created_at: '2026-08-20T00:00:00Z',
            ...builder._insertPayload,
          };
          state.reports.push(row);
          return { data: row, error: null };
        }
        if (table === 'story_reports' && builder._updatePayload !== undefined) {
          const row = state.reports.find((r) => r.id === builder._filters.id);
          if (row === undefined) {
            return { data: null, error: { message: 'not found' } };
          }
          Object.assign(row, builder._updatePayload);
          return { data: row, error: null };
        }
        return { data: null, error: null };
      },
      async maybeSingle() {
        if (table === 'story_members') {
          const key = `${builder._filters.story_id}:${builder._filters.user_id}`;
          const row = state.members.get(key);
          return { data: row ? { role: row.role } : null, error: null };
        }
        if (table === 'chapters') {
          const row = state.chapters.get(builder._filters.id as string);
          return { data: row ?? null, error: null };
        }
        if (table === 'submissions') {
          const row = state.submissions.get(builder._filters.id as string);
          return { data: row ?? null, error: null };
        }
        if (table === 'story_reports') {
          const row = state.reports.find((r) => r.id === builder._filters.id);
          return { data: row ?? null, error: null };
        }
        return { data: null, error: null };
      },
      then(resolve: (result: { data: unknown[]; error: null }) => void) {
        if (table === 'story_reports') {
          const rows = state.reports.filter((r) => r.story_id === builder._filters.story_id);
          resolve({ data: rows, error: null });
          return;
        }
        resolve({ data: [], error: null });
      },
    };

    return builder;
  }

  return {
    createServiceRoleClient: () => ({ from }),
  };
});

const {
  reportChapter,
  reportSubmission,
  listReports,
  resolveReport,
  ChapterNotFoundError,
  SubmissionNotFoundError,
  ReportNotFoundError,
} = await import('@/lib/engine/reports');
const { InsufficientRoleError, NotAMemberError } = await import('@/lib/engine/membership');

const STORY = 'story-1';
const CHAPTER = 'chapter-1';
const SUBMISSION = 'submission-1';

beforeEach(() => {
  state.members.clear();
  state.chapters.clear();
  state.submissions.clear();
  state.reports.length = 0;

  state.members.set(`${STORY}:owner-1`, { role: 'owner' });
  state.members.set(`${STORY}:player-1`, { role: 'player' });
  state.chapters.set(CHAPTER, { story_id: STORY });
  state.submissions.set(SUBMISSION, { story_id: STORY });
});

describe('reportChapter / reportSubmission', () => {
  it('a member reports a chapter with reporter and reason recorded', async () => {
    const report = await reportChapter(CHAPTER, 'player-1', 'Inappropriate content.');
    expect(report.reporterId).toBe('player-1');
    expect(report.reason).toBe('Inappropriate content.');
    expect(report.chapterId).toBe(CHAPTER);
  });

  it('a member reports a submission', async () => {
    const report = await reportSubmission(SUBMISSION, 'player-1', 'Off-topic.');
    expect(report.submissionId).toBe(SUBMISSION);
  });

  it('a non-member cannot report', async () => {
    await expect(reportChapter(CHAPTER, 'stranger', 'Bad.')).rejects.toThrow(NotAMemberError);
  });

  it('rejects an empty reason', async () => {
    await expect(reportChapter(CHAPTER, 'player-1', '   ')).rejects.toThrow('reason is required');
  });

  it('rejects reporting a nonexistent chapter', async () => {
    await expect(reportChapter('missing', 'player-1', 'x')).rejects.toThrow(ChapterNotFoundError);
  });

  it('rejects reporting a nonexistent submission', async () => {
    await expect(reportSubmission('missing', 'player-1', 'x')).rejects.toThrow(SubmissionNotFoundError);
  });
});

describe('listReports', () => {
  it('owner/gm can list reports', async () => {
    await reportChapter(CHAPTER, 'player-1', 'Inappropriate content.');
    const reports = await listReports(STORY, 'owner-1');
    expect(reports).toHaveLength(1);
  });

  it('a player cannot list reports', async () => {
    await expect(listReports(STORY, 'player-1')).rejects.toThrow(InsufficientRoleError);
  });
});

describe('resolveReport', () => {
  it('owner/gm can resolve an open report', async () => {
    const report = await reportChapter(CHAPTER, 'player-1', 'Inappropriate content.');
    const resolved = await resolveReport(report.id, 'owner-1');
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedBy).toBe('owner-1');
    expect(resolved.resolvedAt).not.toBeNull();
  });

  it('does not alter the original reason, reporter, or target', async () => {
    const report = await reportChapter(CHAPTER, 'player-1', 'Inappropriate content.');
    const resolved = await resolveReport(report.id, 'owner-1');
    expect(resolved.reason).toBe('Inappropriate content.');
    expect(resolved.reporterId).toBe('player-1');
    expect(resolved.chapterId).toBe(CHAPTER);
  });

  it('a player cannot resolve a report', async () => {
    const report = await reportChapter(CHAPTER, 'player-1', 'Inappropriate content.');
    await expect(resolveReport(report.id, 'player-1')).rejects.toThrow(InsufficientRoleError);
  });

  it('rejects resolving a nonexistent report', async () => {
    await expect(resolveReport('missing', 'owner-1')).rejects.toThrow(ReportNotFoundError);
  });
});
