import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Entity writes against a fake database, covering the schema-validation
 * boundary added in Phase 2 (entity-schema spec) and the capability status
 * lifecycle enforcement (progression-models spec).
 *
 * The core invariant: a story with no pinned universe keeps Phase 1's fully
 * unconstrained behavior, and a story with a pinned universe gets its data
 * validated by the same code path regardless of what that universe's schema
 * actually contains.
 */

const state = vi.hoisted(() => ({
  members: new Set<string>(),
  stories: new Map<string, Record<string, unknown>>(),
  universeVersions: new Map<string, Record<string, unknown>>(),
  entities: new Map<string, Record<string, unknown>>(),
  history: [] as Record<string, unknown>[],
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => {
  function from(table: string) {
    const builder = {
      _filters: {} as Record<string, unknown>,
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        builder._filters[column] = value;
        return builder;
      },
      async maybeSingle() {
        if (table === 'story_members') {
          const key = `${builder._filters.story_id}:${builder._filters.user_id}`;
          return { data: state.members.has(key) ? { user_id: builder._filters.user_id } : null, error: null };
        }

        if (table === 'stories') {
          const row = state.stories.get(builder._filters.id as string) ?? null;
          return { data: row, error: null };
        }

        if (table === 'universe_versions') {
          const row = [...state.universeVersions.values()].find(
            (v) =>
              v.universe_id === builder._filters.universe_id &&
              v.version === builder._filters.version,
          );
          return { data: row ?? null, error: null };
        }

        if (table === 'entities') {
          const row = state.entities.get(builder._filters.id as string) ?? null;
          return { data: row, error: null };
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
        if (name === 'create_entity_with_history') {
          const id = `entity-${state.entities.size + 1}`;
          const row = {
            id,
            story_id: args.p_story_id,
            type: args.p_type,
            name: args.p_name,
            data: args.p_data,
            controlled_by: args.p_controlled_by ?? null,
            status: 'active',
            updated_at: '2026-08-17T00:00:00Z',
          };
          state.entities.set(id, row);
          state.history.push({ kind: 'create', entity_id: id });
          return { data: row, error: null };
        }

        if (name === 'apply_entity_update') {
          const id = args.p_entity_id as string;
          const existing = state.entities.get(id);

          if (existing === undefined) {
            return { data: null, error: { message: 'not found' } };
          }

          const updated = { ...existing, data: args.p_data };
          state.entities.set(id, updated);
          state.history.push({ kind: 'update', entity_id: id, diff: args.p_diff });
          return { data: updated, error: null };
        }

        return { data: null, error: null };
      },
    }),
    createClient: async () => ({}),
  };
});

const STORY_NO_UNIVERSE = 'story-freeform';
const STORY_WITH_UNIVERSE = 'story-ashfall';
const USER = 'user-1';
const UNIVERSE_ID = 'universe-1';

const ASHFALL_SCHEMA = {
  entity_types: {
    character: {
      label: 'Character',
      fields: [
        { key: 'powerLevel', type: 'number' as const },
        { key: 'abilities', type: 'capability_list' as const },
      ],
    },
  },
};

beforeEach(() => {
  state.members.clear();
  state.stories.clear();
  state.universeVersions.clear();
  state.entities.clear();
  state.history.length = 0;

  state.members.add(`${STORY_NO_UNIVERSE}:${USER}`);
  state.members.add(`${STORY_WITH_UNIVERSE}:${USER}`);

  state.stories.set(STORY_NO_UNIVERSE, {
    id: STORY_NO_UNIVERSE,
    universe_id: null,
    universe_version: null,
  });

  state.stories.set(STORY_WITH_UNIVERSE, {
    id: STORY_WITH_UNIVERSE,
    universe_id: UNIVERSE_ID,
    universe_version: 1,
  });

  state.universeVersions.set(`${UNIVERSE_ID}-v1`, {
    id: `${UNIVERSE_ID}-v1`,
    universe_id: UNIVERSE_ID,
    version: 1,
    entity_schema: ASHFALL_SCHEMA,
    progression_model: 'ability_unlock',
    progression_config: {},
    published_at: '2026-08-17T00:00:00Z',
  });
});

describe('createEntity without a pinned universe', () => {
  it('accepts arbitrary data unchanged, per Phase 1 behavior', async () => {
    const { createEntity } = await import('@/lib/engine/entities');

    const entity = await createEntity(STORY_NO_UNIVERSE, USER, {
      type: 'character',
      name: 'Osric',
      data: { anythingAtAll: { nested: true }, knowledge: ['a fact'] },
      controlledBy: null,
    });

    expect(entity.data).toEqual({ anythingAtAll: { nested: true }, knowledge: ['a fact'] });
  });
});

describe('createEntity with a pinned universe', () => {
  it('accepts data matching the schema', async () => {
    const { createEntity } = await import('@/lib/engine/entities');

    const entity = await createEntity(STORY_WITH_UNIVERSE, USER, {
      type: 'character',
      name: 'Reya',
      data: { powerLevel: 7, abilities: [] },
      controlledBy: null,
    });

    expect(entity.data.powerLevel).toBe(7);
  });

  it('rejects data that violates the schema', async () => {
    const { createEntity, SchemaValidationError } = await import('@/lib/engine/entities');

    await expect(
      createEntity(STORY_WITH_UNIVERSE, USER, {
        type: 'character',
        name: 'Reya',
        data: { powerLevel: 'not-a-number', abilities: [] },
        controlledBy: null,
      }),
    ).rejects.toThrow(SchemaValidationError);
  });
});

describe('updateEntityField capability transitions', () => {
  it('accepts a valid status transition', async () => {
    const { createEntity, updateEntityField } = await import('@/lib/engine/entities');

    const entity = await createEntity(STORY_WITH_UNIVERSE, USER, {
      type: 'character',
      name: 'Reya',
      data: {
        powerLevel: 7,
        abilities: [{ id: 'a1', name: 'Kinetic Echo', status: 'proposed' }],
      },
      controlledBy: null,
    });

    const updated = await updateEntityField(entity.id, USER, 'abilities', [
      { id: 'a1', name: 'Kinetic Echo', status: 'developing' },
    ]);

    expect((updated.data.abilities as { status: string }[])[0]?.status).toBe('developing');
  });

  it('rejects skipping an intermediate status', async () => {
    const { createEntity, updateEntityField, InvalidCapabilityTransitionError } = await import(
      '@/lib/engine/entities'
    );

    const entity = await createEntity(STORY_WITH_UNIVERSE, USER, {
      type: 'character',
      name: 'Reya',
      data: {
        powerLevel: 7,
        abilities: [{ id: 'a1', name: 'Kinetic Echo', status: 'proposed' }],
      },
      controlledBy: null,
    });

    await expect(
      updateEntityField(entity.id, USER, 'abilities', [
        { id: 'a1', name: 'Kinetic Echo', status: 'mastered' },
      ]),
    ).rejects.toThrow(InvalidCapabilityTransitionError);
  });
});

describe('updateEntityField without a pinned universe', () => {
  it('remains unconstrained', async () => {
    const { createEntity, updateEntityField } = await import('@/lib/engine/entities');

    const entity = await createEntity(STORY_NO_UNIVERSE, USER, {
      type: 'character',
      name: 'Osric',
      data: { knowledge: ['a fact'] },
      controlledBy: null,
    });

    const updated = await updateEntityField(entity.id, USER, 'knowledge', ['a fact', 'another fact']);

    expect(updated.data.knowledge).toEqual(['a fact', 'another fact']);
  });
});
