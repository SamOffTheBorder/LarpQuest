import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  members: new Map<string, { role: string; joined_at: string; joined_via_invite: string | null }>(),
  chapters: new Map<string, Record<string, unknown>>(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => {
  function from(table: string) {
    const builder = {
      _filters: {} as Record<string, unknown>,
      _isFilters: {} as Record<string, unknown>,
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
      is(column: string, value: unknown) {
        builder._isFilters[column] = value;
        return builder;
      },
      in() {
        return builder;
      },
      update(payload: Record<string, unknown>) {
        builder._updatePayload = payload;
        return builder;
      },
      async single() {
        if (table === 'chapters' && builder._updatePayload !== undefined) {
          const row = state.chapters.get(builder._filters.id as string);
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
        return { data: null, error: null };
      },
      then(resolve: (result: { data: unknown[]; error: null }) => void) {
        if (table === 'story_members') {
          const rows = [...state.members.entries()]
            .filter(([key]) => key.startsWith(`${builder._filters.story_id}:`))
            .map(([key, value]) => ({ user_id: key.split(':')[1], ...value }));
          resolve({ data: rows, error: null });
          return;
        }
        if (table === 'profiles') {
          resolve({ data: [], error: null });
          return;
        }
        if (table === 'chapters') {
          let rows = [...state.chapters.values()].filter(
            (row) => row.story_id === builder._filters.story_id,
          );
          if ('hidden_at' in builder._isFilters) {
            rows = rows.filter((row) => row.hidden_at === builder._isFilters.hidden_at);
          }
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
    createClient: () => ({ from }),
  };
});

const { listChapters, hideChapter, unhideChapter, ChapterNotFoundError } = await import('@/lib/engine/chapters');
const { InsufficientRoleError } = await import('@/lib/engine/membership');

const STORY = 'story-1';
const CHAPTER = 'chapter-1';

beforeEach(() => {
  state.members.clear();
  state.chapters.clear();

  state.members.set(`${STORY}:owner-1`, { role: 'owner', joined_at: '2026-08-01T00:00:00Z', joined_via_invite: null });
  state.members.set(`${STORY}:player-1`, { role: 'player', joined_at: '2026-08-01T00:00:00Z', joined_via_invite: null });

  state.chapters.set(CHAPTER, {
    id: CHAPTER,
    story_id: STORY,
    turn_number: 1,
    turn_mode: 'narrative',
    prose: 'Once upon a time.',
    published_at: '2026-08-01T00:00:00Z',
    extraction_status: 'complete',
    rolled_back_at: null,
    hidden_at: null,
    hidden_by: null,
  });
});

describe('hideChapter / unhideChapter', () => {
  it('owner can hide a chapter', async () => {
    const chapter = await hideChapter(CHAPTER, 'owner-1');
    expect(chapter.hiddenAt).not.toBeNull();
    expect(chapter.hiddenBy).toBe('owner-1');
  });

  it('owner can unhide a chapter', async () => {
    await hideChapter(CHAPTER, 'owner-1');
    const chapter = await unhideChapter(CHAPTER, 'owner-1');
    expect(chapter.hiddenAt).toBeNull();
    expect(chapter.hiddenBy).toBeNull();
  });

  it('a player cannot hide a chapter', async () => {
    await expect(hideChapter(CHAPTER, 'player-1')).rejects.toThrow(InsufficientRoleError);
  });

  it('rejects hiding a nonexistent chapter', async () => {
    await expect(hideChapter('missing', 'owner-1')).rejects.toThrow(ChapterNotFoundError);
  });
});

describe('listChapters visibility', () => {
  it('a hidden chapter is excluded for non-managers', async () => {
    await hideChapter(CHAPTER, 'owner-1');
    const chapters = await listChapters(STORY, 'player-1');
    expect(chapters).toHaveLength(0);
  });

  it('a hidden chapter is still visible to owner/gm', async () => {
    await hideChapter(CHAPTER, 'owner-1');
    const chapters = await listChapters(STORY, 'owner-1');
    expect(chapters).toHaveLength(1);
    expect(chapters.at(0)?.hiddenAt).not.toBeNull();
  });

  it('a non-hidden chapter is visible to everyone', async () => {
    const chapters = await listChapters(STORY, 'player-1');
    expect(chapters).toHaveLength(1);
  });
});
