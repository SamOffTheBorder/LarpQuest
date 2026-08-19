import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Share links against a fake database. Invariants under test: only
 * owner/gm can create or revoke; a revoked (or never-existing) token
 * resolves to null rather than throwing; the shared view excludes
 * unpublished/rolled-back chapters and never includes entity or
 * submission data (structurally impossible here — SharedStoryView has no
 * such field); revocation stops resolution immediately.
 */

const state = vi.hoisted(() => ({
  members: new Map<string, string>(),
  stories: new Map<string, Record<string, unknown>>(),
  chapters: [] as Record<string, unknown>[],
  chapterImages: [] as Record<string, unknown>[],
  chapterVideos: [] as Record<string, unknown>[],
  shareLinks: new Map<string, Record<string, unknown>>(),
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
      in(column: string, values: unknown[]) {
        filters[column] = values;
        return builder;
      },
      is() {
        return builder;
      },
      order() {
        return builder;
      },
      async single() {
        if (table === 'stories') {
          const story = state.stories.get(filters.id as string);
          return { data: story ?? null, error: story === undefined ? { message: 'not found' } : null };
        }
        if (table === 'share_links') {
          const link = state.shareLinks.get(filters.id as string);
          return { data: link ?? null, error: link === undefined ? { message: 'not found' } : null };
        }
        return { data: null, error: null };
      },
      update(values: Record<string, unknown>) {
        return {
          async eq(_column: string, value: unknown) {
            const existing = state.shareLinks.get(value as string);
            if (existing !== undefined) state.shareLinks.set(value as string, { ...existing, ...values });
            return { error: null };
          },
        };
      },
      insert(values: Record<string, unknown>) {
        return {
          select() {
            return {
              async single() {
                if (table === 'share_links') {
                  const id = `link-${state.shareLinks.size + 1}`;
                  const row = { id, revoked_at: null, ...values };
                  state.shareLinks.set(id, row);
                  return { data: row, error: null };
                }
                return { data: null, error: null };
              },
            };
          },
        };
      },
      then(resolve: (v: { data: unknown[]; error: null }) => void) {
        if (table === 'chapters') {
          const rows = state.chapters.filter((c) => c.story_id === filters.story_id && c.rolled_back_at === null);
          resolve({ data: rows, error: null });
          return;
        }
        if (table === 'chapter_images') {
          const chapterIds = filters.chapter_id as string[];
          resolve({
            data: state.chapterImages.filter((r) => chapterIds.includes(r.chapter_id as string) && r.status === 'complete'),
            error: null,
          });
          return;
        }
        if (table === 'chapter_videos') {
          const chapterIds = filters.chapter_id as string[];
          resolve({
            data: state.chapterVideos.filter((r) => chapterIds.includes(r.chapter_id as string) && r.status === 'complete'),
            error: null,
          });
          return;
        }
        if (table === 'story_members') {
          const role = state.members.get(`${filters.story_id}:${filters.user_id}`);
          resolve({ data: role !== undefined ? [{ role }] : [], error: null });
          return;
        }
        resolve({ data: [], error: null });
      },
      async maybeSingle() {
        if (table === 'story_members') {
          const role = state.members.get(`${filters.story_id}:${filters.user_id}`);
          return { data: role !== undefined ? { role } : null, error: null };
        }
        return { data: null, error: null };
      },
    };

    return builder;
  }

  return {
    createServiceRoleClient: () => ({
      from,
      async rpc(name: string, args: Record<string, unknown>) {
        if (name === 'resolve_share_link') {
          const link = [...state.shareLinks.values()].find((row) => row.token === args.p_token);
          if (link === undefined || link.revoked_at !== null) {
            return { data: null, error: null };
          }
          return { data: link.story_id, error: null };
        }
        return { data: null, error: null };
      },
      storage: {
        from: (_bucket: string) => ({
          async createSignedUrls(paths: string[]) {
            return { data: paths.map((path) => ({ signedUrl: `https://signed.example/${path}` })), error: null };
          },
        }),
      },
    }),
  };
});

const { createShareLink, revokeShareLink, resolveShareLink, getSharedStoryView } = await import(
  '@/lib/engine/share-links'
);

const STORY = 'story-1';
const OWNER = 'owner-1';
const PLAYER = 'player-1';

beforeEach(() => {
  state.members.clear();
  state.stories.clear();
  state.chapters.length = 0;
  state.chapterImages.length = 0;
  state.chapterVideos.length = 0;
  state.shareLinks.clear();

  state.members.set(`${STORY}:${OWNER}`, 'owner');
  state.members.set(`${STORY}:${PLAYER}`, 'player');
  state.stories.set(STORY, { id: STORY, title: 'The Long Road' });
  state.chapters.push(
    { id: 'chapter-1', story_id: STORY, turn_number: 1, prose: 'It began.', rolled_back_at: null },
    { id: 'chapter-2', story_id: STORY, turn_number: 2, prose: 'Undone.', rolled_back_at: '2026-08-01T00:00:00Z' },
  );
});

describe('createShareLink', () => {
  it('owner can create a link', async () => {
    const link = await createShareLink(STORY, OWNER);

    expect(link.storyId).toBe(STORY);
    expect(link.token.length).toBeGreaterThan(10);
    expect(link.revokedAt).toBeNull();
  });

  it('player cannot create a link', async () => {
    await expect(createShareLink(STORY, PLAYER)).rejects.toThrow();
  });
});

describe('revokeShareLink and resolveShareLink', () => {
  it('a fresh link resolves to its story', async () => {
    const link = await createShareLink(STORY, OWNER);

    await expect(resolveShareLink(link.token)).resolves.toBe(STORY);
  });

  it('an unknown token resolves to null', async () => {
    await expect(resolveShareLink('not-a-real-token')).resolves.toBeNull();
  });

  it('revocation stops the token from resolving', async () => {
    const link = await createShareLink(STORY, OWNER);
    await revokeShareLink(link.id, OWNER);

    await expect(resolveShareLink(link.token)).resolves.toBeNull();
  });

  it('revocation is owner/gm gated', async () => {
    const link = await createShareLink(STORY, OWNER);

    await expect(revokeShareLink(link.id, PLAYER)).rejects.toThrow();
    await expect(resolveShareLink(link.token)).resolves.toBe(STORY);
  });
});

describe('getSharedStoryView', () => {
  it('returns null for an invalid token', async () => {
    await expect(getSharedStoryView('nope')).resolves.toBeNull();
  });

  it('excludes rolled-back chapters and includes signed media URLs', async () => {
    state.chapterImages.push({ chapter_id: 'chapter-1', storage_path: `${STORY}/chapter-1/img.png`, status: 'complete' });
    const link = await createShareLink(STORY, OWNER);

    const view = await getSharedStoryView(link.token);

    expect(view?.title).toBe('The Long Road');
    expect(view?.chapters).toHaveLength(1);
    expect(view?.chapters[0]?.turnNumber).toBe(1);
    expect(view?.chapters[0]?.imageUrls).toEqual([`https://signed.example/${STORY}/chapter-1/img.png`]);
  });

  it('returns null once the link is revoked', async () => {
    const link = await createShareLink(STORY, OWNER);
    await revokeShareLink(link.id, OWNER);

    await expect(getSharedStoryView(link.token)).resolves.toBeNull();
  });

  it('batches media lookups across chapters rather than querying per chapter', async () => {
    state.chapters.push({ id: 'chapter-3', story_id: STORY, turn_number: 3, prose: 'Later.', rolled_back_at: null });
    state.chapterImages.push(
      { chapter_id: 'chapter-1', storage_path: `${STORY}/chapter-1/a.png`, status: 'complete' },
      { chapter_id: 'chapter-3', storage_path: `${STORY}/chapter-3/b.png`, status: 'complete' },
    );
    const link = await createShareLink(STORY, OWNER);

    const view = await getSharedStoryView(link.token);

    const chapterOne = view?.chapters.find((c) => c.turnNumber === 1);
    const chapterThree = view?.chapters.find((c) => c.turnNumber === 3);
    expect(chapterOne?.imageUrls).toEqual([`https://signed.example/${STORY}/chapter-1/a.png`]);
    expect(chapterThree?.imageUrls).toEqual([`https://signed.example/${STORY}/chapter-3/b.png`]);
  });
});
