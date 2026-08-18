import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Review actions against a fake database.
 *
 * The invariant under test: accept/edit/reject only ever change a section's
 * `status` (and, for edit, `editedContent`) — never the original `content` a
 * stage produced. A house rule is appended with `source: 'user'`, distinct
 * from research-derived rules. An AU mark leaves the original fact value
 * completely untouched and is attributed via a side-record, not a mutation.
 */

const state = vi.hoisted(() => ({
  drafts: new Map<string, Record<string, unknown>>(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/inngest/client', () => ({
  inngest: { send: async () => {} },
}));

vi.mock('@/lib/supabase/json', () => ({ toJson: (v: unknown) => v }));

vi.mock('@/lib/supabase/server', () => {
  function from(table: string) {
    if (table !== 'universe_drafts') {
      throw new Error(`unexpected table ${table}`);
    }

    const filters: Record<string, unknown> = {};

    const chain = {
      select() {
        return chain;
      },
      eq(column: string, value: unknown) {
        filters[column] = value;
        return chain;
      },
      async maybeSingle() {
        return { data: state.drafts.get(filters.id as string) ?? null, error: null };
      },
      update(patch: Record<string, unknown>) {
        return {
          async eq(_column: string, value: unknown) {
            const existing = state.drafts.get(value as string);
            if (existing !== undefined) {
              state.drafts.set(value as string, { ...existing, ...patch });
            }
            return { error: null };
          },
        };
      },
    };

    return chain;
  }

  return { createServiceRoleClient: () => ({ from }) };
});

const { acceptSection, editSection, rejectSection, addHouseRule, markFactAsAu } = await import(
  '@/lib/research/review'
);
const { DraftNotFoundError } = await import('@/lib/research/drafts');

const validScopingContent = {
  media_type: { value: 'manga', confidence: 'high' },
  genre_tags: { value: ['shonen'], confidence: 'high' },
  has_power_system: { value: true, confidence: 'high' },
  scale_ceiling: { value: 'planetary', confidence: 'medium' },
  primary_conflict_mode: { value: 'combat', confidence: 'high' },
  tone: { value: ['dark'], confidence: 'medium' },
  recommended_turn_modes: { value: ['action'], confidence: 'high' },
};

function seedDraft(id: string, ownerId: string, draft: Record<string, unknown>) {
  state.drafts.set(id, {
    id,
    owner_id: ownerId,
    status: 'ready_for_review',
    input: { name: 'Test Universe' },
    draft,
    universe_id: null,
    published_version: null,
    created_at: '2026-08-18T00:00:00Z',
    updated_at: '2026-08-18T00:00:00Z',
  });
}

beforeEach(() => {
  state.drafts.clear();
});

describe('acceptSection', () => {
  it('marks a section accepted without altering its content', async () => {
    seedDraft('draft-1', 'user-1', {
      auMarks: [],
      scoping: { status: 'pending', content: validScopingContent },
    });

    await acceptSection('draft-1', 'user-1', 'scoping');

    const row = state.drafts.get('draft-1');
    const draft = row?.draft as Record<string, unknown>;
    expect(draft.scoping).toEqual({ status: 'accepted', content: validScopingContent });
  });

  it('rejects a non-owner', async () => {
    seedDraft('draft-1', 'user-1', {
      auMarks: [],
      scoping: { status: 'pending', content: validScopingContent },
    });
    await expect(acceptSection('draft-1', 'user-2', 'scoping')).rejects.toThrow(DraftNotFoundError);
  });
});

const validTimelineContent = {
  starting_point: { value: 'a', confidence: 'high' },
  established_events: { value: ['x'], confidence: 'medium' },
  unresolved_threads: { value: ['y'], confidence: 'low' },
};

describe('editSection', () => {
  it('replaces content via editedContent, attributed as edited rather than accepted', async () => {
    seedDraft('draft-1', 'user-1', {
      auMarks: [],
      timeline: { status: 'pending', content: validTimelineContent },
    });

    const editedContent = {
      ...validTimelineContent,
      starting_point: { value: 'corrected', confidence: 'high' },
    };

    await editSection('draft-1', 'user-1', 'timeline', editedContent);

    const row = state.drafts.get('draft-1');
    const draft = row?.draft as Record<string, unknown>;
    const timeline = draft.timeline as Record<string, unknown>;

    expect(timeline.status).toBe('edited');
    expect(timeline.content).toEqual(validTimelineContent);
    expect(timeline.editedContent).toEqual(editedContent);
  });
});

describe('rejectSection', () => {
  it('keeps content in place, only changes status', async () => {
    seedDraft('draft-1', 'user-1', {
      auMarks: [],
      entities: { status: 'pending', content: { entities: [] } },
    });

    await rejectSection('draft-1', 'user-1', 'entities');

    const row = state.drafts.get('draft-1');
    const draft = row?.draft as Record<string, unknown>;
    expect(draft.entities).toEqual({ status: 'rejected', content: { entities: [] } });
  });
});

describe('addHouseRule', () => {
  it('appends a rule with source "user", distinct from research-derived rules', async () => {
    seedDraft('draft-1', 'user-1', {
      auMarks: [],
      rulePack: {
        status: 'accepted',
        content: { rules: [{ id: 'r1', source: 'research', check: 'no FTL', severity: 'block' }] },
      },
    });

    await addHouseRule('draft-1', 'user-1', 'No character may break the fourth wall.');

    const row = state.drafts.get('draft-1');
    const draft = row?.draft as Record<string, unknown>;
    const rulePack = draft.rulePack as { status: string; editedContent: { rules: { source: string }[] } };

    expect(rulePack.status).toBe('edited');
    expect(rulePack.editedContent.rules).toHaveLength(2);
    expect(rulePack.editedContent.rules[0]?.source).toBe('research');
    expect(rulePack.editedContent.rules[1]?.source).toBe('user');
  });

  it('rejects empty rule text', async () => {
    seedDraft('draft-1', 'user-1', {
      auMarks: [],
      rulePack: { status: 'accepted', content: { rules: [] } },
    });

    await expect(addHouseRule('draft-1', 'user-1', '   ')).rejects.toThrow('must not be empty');
  });
});

describe('markFactAsAu', () => {
  it('retains the original fact value and records the divergence as a side-mark', async () => {
    seedDraft('draft-1', 'user-1', {
      auMarks: [],
      scoping: { status: 'accepted', content: validScopingContent },
    });

    await markFactAsAu('draft-1', 'user-1', 'scoping', 'media_type', 'This AU is a novelization.');

    const row = state.drafts.get('draft-1');
    const draft = row?.draft as Record<string, unknown>;

    // Original fact is byte-for-byte unchanged.
    expect(draft.scoping).toEqual({ status: 'accepted', content: validScopingContent });

    expect(draft.auMarks).toEqual([
      { section: 'scoping', path: 'media_type', divergenceNote: 'This AU is a novelization.' },
    ]);
  });

  it('replaces a prior mark on the same fact rather than duplicating it', async () => {
    seedDraft('draft-1', 'user-1', {
      auMarks: [{ section: 'scoping', path: 'media_type', divergenceNote: 'first note' }],
      scoping: { status: 'accepted', content: validScopingContent },
    });

    await markFactAsAu('draft-1', 'user-1', 'scoping', 'media_type', 'updated note');

    const row = state.drafts.get('draft-1');
    const draft = row?.draft as Record<string, unknown>;
    expect(draft.auMarks).toEqual([{ section: 'scoping', path: 'media_type', divergenceNote: 'updated note' }]);
  });
});
