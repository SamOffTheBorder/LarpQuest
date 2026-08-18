import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Story creation's universe pin (Phase 2), against a fake database.
 *
 * The invariant under test: pinning happens once, at creation, to whatever
 * is the latest published version at that moment — and never moves on its
 * own afterward, only through an explicit upgrade call.
 */

const state = vi.hoisted(() => ({
  stories: new Map<string, Record<string, unknown>>(),
  members: new Map<string, Record<string, unknown>>(),
  universeVersions: new Map<string, Record<string, unknown>>(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => {
  function from(table: string) {
    const builder = {
      _filters: {} as Record<string, unknown>,
      _order: null as { column: string; ascending: boolean } | null,
      _limit: null as number | null,
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        builder._filters[column] = value;
        return builder;
      },
      order(column: string, opts: { ascending: boolean }) {
        builder._order = { column, ascending: opts.ascending };
        return builder;
      },
      limit(n: number) {
        builder._limit = n;
        return builder;
      },
      async maybeSingle() {
        if (table === 'stories') {
          return { data: state.stories.get(builder._filters.id as string) ?? null, error: null };
        }

        if (table === 'story_members') {
          const key = `${builder._filters.story_id}:${builder._filters.user_id}`;
          return { data: state.members.get(key) ?? null, error: null };
        }

        if (table === 'universe_versions') {
          let rows = [...state.universeVersions.values()].filter(
            (row) => row.universe_id === builder._filters.universe_id,
          );

          if (builder._order?.column === 'version' && builder._order.ascending === false) {
            rows = [...rows].sort((a, b) => (b.version as number) - (a.version as number));
          }

          if (builder._limit !== null) {
            rows = rows.slice(0, builder._limit);
          }

          return { data: rows[0] ?? null, error: null };
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
        if (name === 'create_story') {
          const id = `story-${state.stories.size + 1}`;
          const row = {
            id,
            title: args.p_title,
            status: 'active',
            current_turn: 0,
            updated_at: '2026-08-17T00:00:00Z',
            content_rating: args.p_content_rating,
            world_ledger: {},
            model_config: args.p_model_config,
            universe_id: args.p_universe_id ?? null,
            universe_version: args.p_universe_version ?? null,
          };
          state.stories.set(id, row);
          state.members.set(`${id}:${args.p_owner_id}`, { role: 'owner' });
          return { data: row, error: null };
        }

        if (name === 'upgrade_story_universe_version') {
          const id = args.p_story_id as string;
          const existing = state.stories.get(id);

          if (existing === undefined || existing.universe_id === null) {
            return { data: null, error: { message: 'no universe to upgrade' } };
          }

          const updated = { ...existing, universe_version: args.p_universe_version };
          state.stories.set(id, updated);
          return { data: updated, error: null };
        }

        return { data: null, error: null };
      },
    }),
    createClient: async () => ({}),
  };
});

const OWNER = 'owner-1';
const UNIVERSE = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  state.stories.clear();
  state.members.clear();
  state.universeVersions.clear();

  state.universeVersions.set(`${UNIVERSE}-v1`, {
    universe_id: UNIVERSE,
    version: 1,
    entity_schema: { entity_types: {} },
    progression_model: 'none',
    progression_config: {},
    published_at: '2026-08-17T00:00:00Z',
  });
});

describe('createStory without a universe', () => {
  it('leaves universeId/universeVersion null', async () => {
    const { createStory } = await import('@/lib/engine/stories');

    const story = await createStory(OWNER, {
      title: 'A Freeform Story',
      contentRating: 'teen',
      universeId: null,
    });

    expect(story.universeId).toBeNull();
    expect(story.universeVersion).toBeNull();
  });
});

describe('createStory with a universe', () => {
  it('pins the latest published version at creation time', async () => {
    const { createStory } = await import('@/lib/engine/stories');

    const story = await createStory(OWNER, {
      title: 'A Pinned Story',
      contentRating: 'teen',
      universeId: UNIVERSE,
    });

    expect(story.universeId).toBe(UNIVERSE);
    expect(story.universeVersion).toBe(1);
  });

  it('does not move when the universe publishes a newer version afterward', async () => {
    const { createStory } = await import('@/lib/engine/stories');

    const story = await createStory(OWNER, {
      title: 'A Pinned Story',
      contentRating: 'teen',
      universeId: UNIVERSE,
    });

    // Universe publishes v2 after the story was created.
    state.universeVersions.set(`${UNIVERSE}-v2`, {
      universe_id: UNIVERSE,
      version: 2,
      entity_schema: { entity_types: {} },
      progression_model: 'none',
      progression_config: {},
      published_at: '2026-08-17T01:00:00Z',
    });

    expect(state.stories.get(story.id)?.universe_version).toBe(1);
  });
});

describe('upgradeStoryUniverseVersion', () => {
  it('moves the pin only through an explicit call', async () => {
    const { createStory, upgradeStoryUniverseVersion } = await import('@/lib/engine/stories');

    const story = await createStory(OWNER, {
      title: 'A Pinned Story',
      contentRating: 'teen',
      universeId: UNIVERSE,
    });

    state.universeVersions.set(`${UNIVERSE}-v2`, {
      universe_id: UNIVERSE,
      version: 2,
      entity_schema: { entity_types: {} },
      progression_model: 'none',
      progression_config: {},
      published_at: '2026-08-17T01:00:00Z',
    });

    const upgraded = await upgradeStoryUniverseVersion(story.id, OWNER, 2);

    expect(upgraded.universeVersion).toBe(2);
  });
});
