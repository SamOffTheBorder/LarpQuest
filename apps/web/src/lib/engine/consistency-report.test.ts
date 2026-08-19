import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Read helpers for the consistency report (consistency-report capability),
 * against a fake database. RLS is the real access control (any member can
 * read); these tests cover the shape and the evaluated-vs-clean distinction.
 */

const state = vi.hoisted(() => ({
  members: new Map<string, string>(),
  chapters: new Map<string, Record<string, unknown>>(),
  proposals: [] as Record<string, unknown>[],
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => {
  function from(table: string) {
    const filters: Record<string, unknown> = {};

    const builder = {
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        filters[column] = value;
        return builder;
      },
      order() {
        return builder;
      },
      async maybeSingle() {
        if (table === 'chapters') {
          return { data: state.chapters.get(filters.id as string) ?? null, error: null };
        }

        if (table === 'story_members') {
          const role = state.members.get(`${filters.story_id}:${filters.user_id}`);
          return { data: role !== undefined ? { role } : null, error: null };
        }

        return { data: null, error: null };
      },
      then(resolve: (v: { data: unknown[]; error: null }) => void) {
        if (table === 'proposals') {
          resolve({ data: state.proposals.filter((row) => row.story_id === filters.story_id), error: null });
          return;
        }

        resolve({ data: [], error: null });
      },
    };

    return builder;
  }

  return { createServiceRoleClient: () => ({ from }) };
});

const { getChapterValidationReport, getStoryProposalHistory, ChapterNotFoundError } = await import(
  '@/lib/engine/consistency-report'
);

const STORY = 'story-1';
const USER = 'user-1';

beforeEach(() => {
  state.members.clear();
  state.chapters.clear();
  state.proposals = [];

  state.members.set(`${STORY}:${USER}`, 'player');
});

describe('getChapterValidationReport', () => {
  it('returns evaluated: true and the parsed flags for a flagged chapter', async () => {
    state.chapters.set('chapter-1', {
      id: 'chapter-1',
      story_id: STORY,
      turn_number: 3,
      validation_report: [
        { rule_id: 'standard.intent_not_addressed', severity: 'warn', description: 'Ignored a submission.' },
      ],
    });

    const report = await getChapterValidationReport('chapter-1', USER);

    expect(report.evaluated).toBe(true);
    expect(report.flags).toEqual([
      { ruleId: 'standard.intent_not_addressed', severity: 'warn', description: 'Ignored a submission.', entityId: null, capabilityId: null },
    ]);
  });

  it('distinguishes an empty (clean) report from an unevaluated chapter', async () => {
    state.chapters.set('chapter-clean', { id: 'chapter-clean', story_id: STORY, turn_number: 1, validation_report: [] });
    state.chapters.set('chapter-unevaluated', { id: 'chapter-unevaluated', story_id: STORY, turn_number: 2, validation_report: null });

    const clean = await getChapterValidationReport('chapter-clean', USER);
    const unevaluated = await getChapterValidationReport('chapter-unevaluated', USER);

    expect(clean.evaluated).toBe(true);
    expect(clean.flags).toEqual([]);

    expect(unevaluated.evaluated).toBe(false);
    expect(unevaluated.flags).toEqual([]);
  });

  it('throws ChapterNotFoundError for a missing chapter', async () => {
    await expect(getChapterValidationReport('missing', USER)).rejects.toThrow(ChapterNotFoundError);
  });
});

describe('getStoryProposalHistory', () => {
  it('maps proposal rows including override state', async () => {
    state.proposals = [
      {
        id: 'proposal-1',
        story_id: STORY,
        entity_id: 'entity-1',
        proposal: 'Unlock Domain Expansion.',
        verdict: 'reject',
        reasoning: 'No basis.',
        gm_override: true,
        created_at: '2026-08-21T00:00:00Z',
      },
    ];

    const history = await getStoryProposalHistory(STORY, USER);

    expect(history).toEqual([
      {
        id: 'proposal-1',
        entityId: 'entity-1',
        proposal: 'Unlock Domain Expansion.',
        verdict: 'reject',
        reasoning: 'No basis.',
        gmOverride: true,
        createdAt: '2026-08-21T00:00:00Z',
      },
    ]);
  });
});
