import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Universe/version persistence against a fake database.
 *
 * The invariant under test is universe-versioning's core promise: publishing
 * a new version never mutates an existing one, and an unregistered
 * progression model is rejected before any row is written.
 */

const state = vi.hoisted(() => ({
  universes: new Map<string, Record<string, unknown>>(),
  versions: new Map<string, Record<string, unknown>>(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => {
  function versionsForUniverse(universeId: string) {
    return [...state.versions.values()].filter((row) => row.universe_id === universeId);
  }

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
        if (table === 'universes') {
          const row = state.universes.get(builder._filters.id as string) ?? null;
          return { data: row, error: null };
        }

        if (table === 'universe_versions') {
          let rows = versionsForUniverse(builder._filters.universe_id as string);

          if (builder._filters.version !== undefined) {
            rows = rows.filter((row) => row.version === builder._filters.version);
          }

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
        if (name === 'create_universe_with_version') {
          const universeId = `universe-${state.universes.size + 1}`;
          state.universes.set(universeId, {
            id: universeId,
            owner_id: args.p_owner_id,
            name: args.p_name,
            created_at: '2026-08-17T00:00:00Z',
          });

          const versionId = `${universeId}-v1`;
          const row = {
            id: versionId,
            universe_id: universeId,
            version: 1,
            entity_schema: args.p_entity_schema,
            progression_model: args.p_progression_model,
            progression_config: args.p_progression_config,
            published_at: '2026-08-17T00:00:00Z',
          };
          state.versions.set(versionId, row);
          return { data: row, error: null };
        }

        if (name === 'publish_universe_version') {
          const universeId = args.p_universe_id as string;
          const universe = state.universes.get(universeId);

          if (universe === undefined || universe.owner_id !== args.p_owner_id) {
            return { data: null, error: { message: 'not owned' } };
          }

          const existing = versionsForUniverse(universeId);
          const nextVersion = existing.length === 0
            ? 1
            : Math.max(...existing.map((row) => row.version as number)) + 1;

          const versionId = `${universeId}-v${nextVersion}`;
          const row = {
            id: versionId,
            universe_id: universeId,
            version: nextVersion,
            entity_schema: args.p_entity_schema,
            progression_model: args.p_progression_model,
            progression_config: args.p_progression_config,
            published_at: '2026-08-17T01:00:00Z',
          };
          state.versions.set(versionId, row);
          return { data: row, error: null };
        }

        return { data: null, error: null };
      },
    }),
    createClient: async () => ({}),
  };
});

const OWNER = 'owner-1';

const POWER_SCHEMA = {
  entity_types: {
    character: {
      label: 'Character',
      fields: [{ key: 'abilities', type: 'capability_list' as const }],
    },
  },
};

beforeEach(() => {
  state.universes.clear();
  state.versions.clear();
});

describe('createUniverse', () => {
  it('creates a universe and its first published version', async () => {
    const { createUniverse } = await import('@/lib/engine/universes');

    const version = await createUniverse(OWNER, {
      name: 'Ashfall Legion',
      entitySchema: POWER_SCHEMA,
      progressionModel: 'ability_unlock',
      progressionConfig: {},
    });

    expect(version.version).toBe(1);
    expect(version.progressionModel).toBe('ability_unlock');
  });

  it('rejects an unregistered progression model before writing anything', async () => {
    const { createUniverse } = await import('@/lib/engine/universes');

    await expect(
      createUniverse(OWNER, {
        name: 'Bad Universe',
        entitySchema: POWER_SCHEMA,
        progressionModel: 'numeric_scaling',
        progressionConfig: {},
      }),
    ).rejects.toThrow(/numeric_scaling/);

    expect(state.universes.size).toBe(0);
  });
});

describe('publishUniverseVersion', () => {
  it('appends a new version without changing the prior one', async () => {
    const { createUniverse, publishUniverseVersion, getUniverseVersion } = await import(
      '@/lib/engine/universes'
    );

    const v1 = await createUniverse(OWNER, {
      name: 'Ashfall Legion',
      entitySchema: POWER_SCHEMA,
      progressionModel: 'ability_unlock',
      progressionConfig: {},
    });

    const updatedSchema = {
      entity_types: {
        character: {
          label: 'Character',
          fields: [
            { key: 'abilities', type: 'capability_list' as const },
            { key: 'powerLevel', type: 'number' as const },
          ],
        },
      },
    };

    const v2 = await publishUniverseVersion(v1.universeId, OWNER, {
      name: 'Ashfall Legion',
      entitySchema: updatedSchema,
      progressionModel: 'ability_unlock',
      progressionConfig: {},
    });

    expect(v2.version).toBe(2);

    const stillV1 = await getUniverseVersion(v1.universeId, 1);
    expect(stillV1.entitySchema).toEqual(POWER_SCHEMA);
  });
});

describe('getLatestUniverseVersion', () => {
  it('returns the highest published version', async () => {
    const { createUniverse, publishUniverseVersion, getLatestUniverseVersion } = await import(
      '@/lib/engine/universes'
    );

    const v1 = await createUniverse(OWNER, {
      name: 'Ashfall Legion',
      entitySchema: POWER_SCHEMA,
      progressionModel: 'ability_unlock',
      progressionConfig: {},
    });

    await publishUniverseVersion(v1.universeId, OWNER, {
      name: 'Ashfall Legion',
      entitySchema: POWER_SCHEMA,
      progressionModel: 'ability_unlock',
      progressionConfig: {},
    });

    const latest = await getLatestUniverseVersion(v1.universeId);
    expect(latest.version).toBe(2);
  });
});
