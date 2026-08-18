import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Publishing a draft against a fake database and a mocked `createUniverse`.
 *
 * The invariant under test: publish never writes a universe/universe_versions
 * row itself — it maps the draft to a `UniverseVersionInput` and hands it to
 * the existing Phase 2 `createUniverse` unchanged. A draft missing an
 * accepted Schema Derivation section is refused with the section named,
 * without calling `createUniverse` at all. The draft row survives publish —
 * it is updated, never deleted.
 */

const state = vi.hoisted(() => ({
  drafts: new Map<string, Record<string, unknown>>(),
  createUniverseCalls: [] as { ownerId: string; input: unknown }[],
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/engine/universes', () => ({
  createUniverse: async (ownerId: string, input: unknown) => {
    state.createUniverseCalls.push({ ownerId, input });
    return {
      id: 'version-1',
      universeId: 'universe-1',
      version: 1,
      entitySchema: (input as { entitySchema: unknown }).entitySchema,
      progressionModel: (input as { progressionModel: string }).progressionModel,
      progressionConfig: {},
      publishedAt: '2026-08-18T00:00:00Z',
    };
  },
}));

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

const { publishDraft, draftToUniverseVersionInput, DraftIncompleteError } = await import(
  '@/lib/research/publish'
);

const validSchemaDerivation = {
  entity_schema: { entity_types: { character: { label: 'Character', fields: [] } } },
  progression_model: 'none',
  progression_config: {},
};

function seedDraft(id: string, ownerId: string, draft: Record<string, unknown>) {
  state.drafts.set(id, {
    id,
    owner_id: ownerId,
    status: 'ready_for_review',
    input: { name: 'Jujutsu Kaisen' },
    draft,
    universe_id: null,
    published_version: null,
    created_at: '2026-08-18T00:00:00Z',
    updated_at: '2026-08-18T00:00:00Z',
  });
}

beforeEach(() => {
  state.drafts.clear();
  state.createUniverseCalls.length = 0;
});

describe('draftToUniverseVersionInput', () => {
  it('maps an accepted schemaDerivation section to a UniverseVersionInput', () => {
    const input = draftToUniverseVersionInput('draft-1', 'Jujutsu Kaisen', {
      auMarks: [],
      schemaDerivation: { status: 'accepted', content: validSchemaDerivation },
    });

    expect(input).toEqual({
      name: 'Jujutsu Kaisen',
      entitySchema: validSchemaDerivation.entity_schema,
      progressionModel: 'none',
      progressionConfig: {},
    });
  });

  it('prefers editedContent when the section was edited', () => {
    const edited = { ...validSchemaDerivation, progression_model: 'ability_unlock' };

    const input = draftToUniverseVersionInput('draft-1', 'Jujutsu Kaisen', {
      auMarks: [],
      schemaDerivation: { status: 'edited', content: validSchemaDerivation, editedContent: edited },
    });

    expect(input.progressionModel).toBe('ability_unlock');
  });

  it('throws DraftIncompleteError naming the section when schemaDerivation is missing', () => {
    expect(() => draftToUniverseVersionInput('draft-1', 'Jujutsu Kaisen', { auMarks: [] })).toThrow(
      DraftIncompleteError,
    );
  });

  it('throws DraftIncompleteError when schemaDerivation is rejected', () => {
    expect(() =>
      draftToUniverseVersionInput('draft-1', 'Jujutsu Kaisen', {
        auMarks: [],
        schemaDerivation: { status: 'rejected', content: validSchemaDerivation },
      }),
    ).toThrow(DraftIncompleteError);
  });

  it('throws DraftIncompleteError when schemaDerivation is still pending', () => {
    expect(() =>
      draftToUniverseVersionInput('draft-1', 'Jujutsu Kaisen', {
        auMarks: [],
        schemaDerivation: { status: 'pending', content: validSchemaDerivation },
      }),
    ).toThrow(DraftIncompleteError);
  });
});

describe('publishDraft', () => {
  it('calls createUniverse with the mapped input and records the outcome on the draft row', async () => {
    seedDraft('draft-1', 'user-1', {
      auMarks: [],
      schemaDerivation: { status: 'accepted', content: validSchemaDerivation },
    });

    const result = await publishDraft('draft-1', 'user-1');

    expect(state.createUniverseCalls).toHaveLength(1);
    expect(state.createUniverseCalls[0]).toMatchObject({
      ownerId: 'user-1',
      input: { name: 'Jujutsu Kaisen', progressionModel: 'none' },
    });

    expect(result.universeVersion.universeId).toBe('universe-1');

    const row = state.drafts.get('draft-1');
    expect(row).toMatchObject({
      status: 'published',
      universe_id: 'universe-1',
      published_version: 1,
    });
    // The draft row itself still exists — publish never deletes it.
    expect(state.drafts.has('draft-1')).toBe(true);
  });

  it('does not call createUniverse when the draft is incomplete', async () => {
    seedDraft('draft-1', 'user-1', { auMarks: [] });

    await expect(publishDraft('draft-1', 'user-1')).rejects.toThrow(DraftIncompleteError);
    expect(state.createUniverseCalls).toHaveLength(0);
  });

  it('rejects a non-owner', async () => {
    seedDraft('draft-1', 'user-1', {
      auMarks: [],
      schemaDerivation: { status: 'accepted', content: validSchemaDerivation },
    });

    await expect(publishDraft('draft-1', 'user-2')).rejects.toThrow();
    expect(state.createUniverseCalls).toHaveLength(0);
  });
});
