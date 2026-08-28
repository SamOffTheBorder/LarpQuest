import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Premise generation, regeneration, and approval against a fake database.
 *
 * The invariant this file exists for: a section the owner accepted or edited
 * survives regeneration byte-identical, *even when the model returns
 * something different for it*. That is the whole point of the like/dislike
 * loop — a re-roll must only ever change what the owner rejected.
 *
 * The second invariant is that approval seeds real state: kept cast members
 * become entities through `createEntity` (so history rows and pinned-schema
 * validation both run), cut members seed nothing, and a cast member that
 * fails to create does not take the story down with it.
 */

const state = vi.hoisted(() => ({
  drafts: new Map<string, Record<string, unknown>>(),
  stories: new Map<string, Record<string, unknown>>(),
  entities: [] as { storyId: string; type: string; name: string; data: unknown }[],
  modelResponses: [] as unknown[],
  modelPrompts: [] as string[],
  entityFailures: new Set<string>(),
  usageRows: [] as { role: string; storyId: string | null; userId: string | null }[],
}));

// gateway.ts (imported below via vi.importActual, since only callStructured
// is stubbed) reads env.ts at module load, which parses process.env eagerly.
// vi.hoisted runs before any vi.mock factory, so this must set the required
// vars here rather than as a plain top-level statement.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3000';
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
  process.env.ENCRYPTION_MASTER_KEY ??= Buffer.alloc(32).toString('base64');
  process.env.WORKER_SECRET ??= 'test-worker-secret-value';
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/json', () => ({ toJson: (v: unknown) => v }));

vi.mock('@/lib/ai/api-key', () => ({
  resolveUserApiKey: async () => ({ key: 'test-key', source: 'platform' }),
}));

vi.mock('@/lib/ai/usage', () => ({
  createUsageRecorder: (storyId: string | null, userId: string | null) => ({
    async record(entry: { role: string }) {
      state.usageRows.push({ role: entry.role, storyId, userId });
    },
  }),
}));

vi.mock('@/lib/ai/spend', () => ({
  createBudgetGuard: () => ({ async assertWithinBudget() {} }),
}));

vi.mock('@/lib/ai/gateway', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/gateway')>('@/lib/ai/gateway');

  return {
    ...actual,
    async callStructured(
      deps: { usage: { record: (e: unknown) => Promise<void> } },
      args: { role: string; userPrompt: string; schema: { parse: (v: unknown) => unknown } },
    ) {
      state.modelPrompts.push(args.userPrompt);
      await deps.usage.record({ role: args.role });

      const next = state.modelResponses.shift();
      if (next === undefined) {
        throw new Error('no queued model response');
      }
      if (next instanceof Error) {
        throw next;
      }

      return { data: args.schema.parse(next), resolvedModel: 'test-model', usedFallbackModel: true };
    },
  };
});

vi.mock('@/lib/engine/stories', () => ({
  createStory: async (userId: string, input: { title: string; universeId: string | null }) => {
    const id = `story-${state.stories.size + 1}`;
    state.stories.set(id, { id, ownerId: userId, title: input.title, worldLedger: {} });
    return { id, title: input.title, universeId: input.universeId };
  },
}));

vi.mock('@/lib/engine/entities', () => ({
  createEntity: async (
    storyId: string,
    _userId: string,
    input: { type: string; name: string; data: unknown },
  ) => {
    if (state.entityFailures.has(input.name)) {
      throw new Error(`schema rejected ${input.name}`);
    }
    state.entities.push({ storyId, type: input.type, name: input.name, data: input.data });
    return { id: `entity-${state.entities.length}` };
  },
}));

vi.mock('@/lib/engine/universes', () => ({
  getLatestUniverseVersion: async () => ({
    canonBibleRulesOnly: { rules: ['no resurrection'] },
    canonBibleSummary: null,
  }),
}));

vi.mock('@/lib/supabase/server', () => {
  function from(table: string) {
    if (table === 'story_premise_drafts') {
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq(column: string, value: unknown) {
          filters[column] = value;
          return chain;
        },
        order: () => chain,
        async maybeSingle() {
          return { data: state.drafts.get(filters.id as string) ?? null, error: null };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(_column: string, value: unknown) {
              const existing = state.drafts.get(value as string);
              if (existing !== undefined) {
                state.drafts.set(value as string, { ...existing, ...patch });
              }
              const updated = {
                select: () => ({
                  async maybeSingle() {
                    return { data: state.drafts.get(value as string) ?? null, error: null };
                  },
                }),
                then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
              };
              return updated;
            },
          };
        },
      };
      return chain;
    }

    if (table === 'stories') {
      return {
        update(patch: Record<string, unknown>) {
          return {
            async eq(_column: string, value: unknown) {
              const existing = state.stories.get(value as string);
              if (existing !== undefined) {
                state.stories.set(value as string, { ...existing, ...patch });
              }
              return { error: null };
            },
          };
        },
      };
    }

    throw new Error(`unexpected table ${table}`);
  }

  return { createServiceRoleClient: () => ({ from }) };
});

const { approvePremise, editSection, acceptSection, rejectSection, generatePremise, NothingToRegenerateError, regeneratePremise, setCastMemberKept } =
  await import('@/lib/engine/premise');
const { PremiseDraftNotFoundError } = await import('@/lib/engine/premise-drafts');
const { effectiveContent, fromGenerated } = await import('@/lib/engine/premise-schema');

const OWNER = 'user-1';

const generated = {
  title: 'The Long Fall',
  tldr: 'A crew takes one last job.',
  setting: 'A city built vertically, in perpetual rain.',
  openingSituation: 'The vault door closes early.',
  cast: [
    { name: 'Vesper', type: 'character', role: 'fixer', description: 'Runs the crew.' },
    { name: 'Tan', type: 'character', role: 'infiltrator', description: 'Gets inside.' },
  ],
  hooks: ['Someone tipped off the arcology.'],
  toneGuidance: 'Wry and tense.',
};

const rewritten = {
  ...generated,
  title: 'Something Else',
  tldr: 'A totally different pitch.',
  setting: 'A rewritten setting the owner never asked for.',
  openingSituation: 'A different opening.',
  cast: [{ name: 'Nobody', type: 'character', role: 'stranger', description: 'New.' }],
  hooks: ['A different hook.'],
  toneGuidance: 'Different tone.',
};

function seedDraft(overrides: Record<string, unknown> = {}): string {
  const id = 'draft-1';
  state.drafts.set(id, {
    id,
    owner_id: OWNER,
    status: 'draft',
    input: {
      pitch: 'A heist that goes wrong immediately.',
      settingSketch: '',
      toneNotes: '',
      mustInclude: '',
      mustAvoid: '',
      castSize: 2,
      contentRating: 'teen',
      universeId: null,
    },
    premise: {},
    notes: '',
    story_id: null,
    created_at: '2026-08-27T00:00:00Z',
    updated_at: '2026-08-27T00:00:00Z',
    ...overrides,
  });
  return id;
}

beforeEach(() => {
  state.drafts.clear();
  state.stories.clear();
  state.entities.length = 0;
  state.modelResponses.length = 0;
  state.modelPrompts.length = 0;
  state.entityFailures.clear();
  state.usageRows.length = 0;
});

describe('generatePremise', () => {
  it('stores every section as pending and records usage against the user', async () => {
    const id = seedDraft();
    state.modelResponses.push(generated);

    const draft = await generatePremise(id, OWNER);

    expect(draft.premise?.tldr.status).toBe('pending');
    expect(draft.premise?.cast.content).toHaveLength(2);
    expect(state.usageRows).toEqual([{ role: 'premise', storyId: null, userId: OWNER }]);
  });

  it('leaves the draft untouched when the model call fails', async () => {
    const id = seedDraft();
    state.modelResponses.push(new Error('transport exploded'));

    await expect(generatePremise(id, OWNER)).rejects.toThrow('transport exploded');
    expect(state.drafts.get(id)?.premise).toEqual({});
  });

  it('refuses a draft the user does not own', async () => {
    const id = seedDraft();

    await expect(generatePremise(id, 'someone-else')).rejects.toBeInstanceOf(
      PremiseDraftNotFoundError,
    );
  });
});

describe('regeneratePremise', () => {
  it('keeps accepted content byte-identical even when the model rewrites it', async () => {
    const id = seedDraft({ premise: fromGenerated(generated) });
    await acceptSection(id, OWNER, 'setting');
    await rejectSection(id, OWNER, 'tldr');
    state.modelResponses.push(rewritten);

    const draft = await regeneratePremise(id, OWNER);

    // Pinned: survives the model's attempt to rewrite it.
    expect(draft.premise?.setting.content).toBe(generated.setting);
    expect(draft.premise?.setting.status).toBe('accepted');
    // Rejected: replaced.
    expect(draft.premise?.tldr.content).toBe(rewritten.tldr);
  });

  it('preserves an owner edit and its attribution', async () => {
    const id = seedDraft({ premise: fromGenerated(generated) });
    await editSection(id, OWNER, 'tldr', 'My own TLDR.');
    state.modelResponses.push(rewritten);

    const draft = await regeneratePremise(id, OWNER);

    expect(draft.premise?.tldr.status).toBe('edited');
    expect(effectiveContent(draft.premise!, 'tldr')).toBe('My own TLDR.');
  });

  it('holds the title steady unless everything is being regenerated', async () => {
    const id = seedDraft({ premise: fromGenerated(generated) });
    await acceptSection(id, OWNER, 'setting');
    state.modelResponses.push(rewritten);

    expect((await regeneratePremise(id, OWNER)).premise?.title).toBe('The Long Fall');
  });

  it('takes a new title when no section was settled', async () => {
    const id = seedDraft({ premise: fromGenerated(generated) });
    state.modelResponses.push(rewritten);

    expect((await regeneratePremise(id, OWNER)).premise?.title).toBe('Something Else');
  });

  it('makes no model call when every section is settled', async () => {
    const id = seedDraft({ premise: fromGenerated(generated) });
    for (const key of ['tldr', 'setting', 'openingSituation', 'cast', 'hooks', 'toneGuidance'] as const) {
      await acceptSection(id, OWNER, key);
    }

    await expect(regeneratePremise(id, OWNER)).rejects.toBeInstanceOf(NothingToRegenerateError);
    expect(state.modelPrompts).toHaveLength(0);
  });

  it('leaves the reviewed premise intact when regeneration fails', async () => {
    const id = seedDraft({ premise: fromGenerated(generated) });
    await acceptSection(id, OWNER, 'setting');
    state.modelResponses.push(new Error('model down'));

    await expect(regeneratePremise(id, OWNER)).rejects.toThrow('model down');

    const stored = state.drafts.get(id)?.premise as { setting: { content: string } };
    expect(stored.setting.content).toBe(generated.setting);
  });

  it('generates from scratch when the draft has no premise yet', async () => {
    const id = seedDraft();
    state.modelResponses.push(generated);

    expect((await regeneratePremise(id, OWNER)).premise?.title).toBe('The Long Fall');
  });
});

describe('setCastMemberKept', () => {
  it('cuts one member while retaining it and leaving the others kept', async () => {
    const id = seedDraft({ premise: fromGenerated(generated) });

    const draft = await setCastMemberKept(id, OWNER, 1, false);
    const cast = effectiveContent(draft.premise!, 'cast');

    expect(cast.map((m) => m.kept)).toEqual([true, false]);
    // Retained, not deleted.
    expect(cast).toHaveLength(2);
  });

  it('restores a cut member with its content intact', async () => {
    const id = seedDraft({ premise: fromGenerated(generated) });
    await setCastMemberKept(id, OWNER, 0, false);

    const draft = await setCastMemberKept(id, OWNER, 0, true);
    const cast = effectiveContent(draft.premise!, 'cast');

    expect(cast[0]).toMatchObject({ name: 'Vesper', kept: true, description: 'Runs the crew.' });
  });

  it('rejects an index outside the cast', async () => {
    const id = seedDraft({ premise: fromGenerated(generated) });

    await expect(setCastMemberKept(id, OWNER, 5, false)).rejects.toThrow('No cast member at index 5');
  });
});

describe('approvePremise', () => {
  it('creates the story, seeds the ledger, and seeds the kept cast as entities', async () => {
    const id = seedDraft({ premise: fromGenerated(generated) });

    const { storyId, failedCast } = await approvePremise(id, OWNER);

    expect(failedCast).toEqual([]);
    expect(state.entities.map((e) => e.name)).toEqual(['Vesper', 'Tan']);
    expect(state.entities[0]).toMatchObject({
      storyId,
      type: 'character',
      data: { role: 'fixer', description: 'Runs the crew.' },
    });

    const ledger = (state.stories.get(storyId) as { world_ledger: { premise: Record<string, unknown> } })
      .world_ledger.premise;
    expect(ledger.title).toBe('The Long Fall');
    expect(ledger.setting).toBe(generated.setting);
  });

  it('seeds nothing for cut members', async () => {
    const id = seedDraft({ premise: fromGenerated(generated) });
    await setCastMemberKept(id, OWNER, 1, false);

    await approvePremise(id, OWNER);

    expect(state.entities.map((e) => e.name)).toEqual(['Vesper']);
  });

  it('succeeds with no entities when every member was cut', async () => {
    const id = seedDraft({ premise: fromGenerated(generated) });
    await setCastMemberKept(id, OWNER, 0, false);
    await setCastMemberKept(id, OWNER, 1, false);

    const { storyId } = await approvePremise(id, OWNER);

    expect(state.entities).toEqual([]);
    expect(state.stories.has(storyId)).toBe(true);
  });

  it('omits a rejected section from the ledger and seeds no cast when the cast is rejected', async () => {
    const id = seedDraft({ premise: fromGenerated(generated) });
    await rejectSection(id, OWNER, 'hooks');
    await rejectSection(id, OWNER, 'cast');

    const { storyId } = await approvePremise(id, OWNER);
    const ledger = (state.stories.get(storyId) as { world_ledger: { premise: Record<string, unknown> } })
      .world_ledger.premise;

    expect(ledger.hooks).toBeUndefined();
    expect(state.entities).toEqual([]);
  });

  it('writes the owner edit to the ledger rather than the generated text', async () => {
    const id = seedDraft({ premise: fromGenerated(generated) });
    await editSection(id, OWNER, 'toneGuidance', 'Play it warmer than it looks.');

    const { storyId } = await approvePremise(id, OWNER);
    const ledger = (state.stories.get(storyId) as { world_ledger: { premise: Record<string, unknown> } })
      .world_ledger.premise;

    expect(ledger.toneGuidance).toBe('Play it warmer than it looks.');
  });

  it('keeps the story and names the failures when a cast member cannot be created', async () => {
    const id = seedDraft({ premise: fromGenerated(generated) });
    state.entityFailures.add('Tan');

    const { storyId, failedCast } = await approvePremise(id, OWNER);

    expect(state.stories.has(storyId)).toBe(true);
    expect(state.entities.map((e) => e.name)).toEqual(['Vesper']);
    expect(failedCast).toEqual([{ name: 'Tan', reason: 'schema rejected Tan' }]);
  });

  it('marks the draft approved and records the story it produced', async () => {
    const id = seedDraft({ premise: fromGenerated(generated) });

    const { storyId } = await approvePremise(id, OWNER);

    expect(state.drafts.get(id)).toMatchObject({ status: 'approved', story_id: storyId });
  });

  it('creates no story for a non-owner', async () => {
    const id = seedDraft({ premise: fromGenerated(generated) });

    await expect(approvePremise(id, 'someone-else')).rejects.toBeInstanceOf(
      PremiseDraftNotFoundError,
    );
    expect(state.stories.size).toBe(0);
  });
});

describe('universe-pinned generation', () => {
  it('passes canon context into the prompt', async () => {
    const id = seedDraft({
      input: {
        pitch: 'A heist.',
        settingSketch: '',
        toneNotes: '',
        mustInclude: '',
        mustAvoid: '',
        castSize: 2,
        contentRating: 'teen',
        universeId: '00000000-0000-4000-8000-000000000001',
      },
    });
    state.modelResponses.push(generated);

    await generatePremise(id, OWNER);

    expect(state.modelPrompts[0]).toContain('no resurrection');
  });
});
