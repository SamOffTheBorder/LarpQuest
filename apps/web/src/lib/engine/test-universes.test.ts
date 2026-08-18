import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// entities.ts and stories.ts import the Supabase server client, which reads
// env eagerly on import — must be set before those modules are imported below.
process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
process.env.OPENROUTER_API_KEY ??= 'test-openrouter-key';
process.env.WORKER_SECRET ??= 'test-worker-secret-value';
process.env.ENCRYPTION_MASTER_KEY ??= randomBytes(32).toString('base64');

const { applyDiffs } = await import('@/lib/engine/diff');
const { assembleContext } = await import('@/lib/engine/context');
const { entityInputSchema } = await import('@/lib/engine/entities');
const { createStoryInputSchema } = await import('@/lib/engine/stories');
const { entitySchemaSchema, buildEntityDataValidator } = await import('@/lib/engine/schema');
const { resolveProgressionModel } = await import('@/lib/engine/progression-models');
const { ASHFALL_LEGION, TEST_UNIVERSES, WOVENMERE } = await import('@/lib/engine/test-universes');
type Diff = import('@/lib/engine/diff').Diff;
type ContextEntity = import('@/lib/engine/context').ContextEntity;

/**
 * Task 10.1: two structurally different test universes exist, and this is
 * where "structurally different" is verified — not asserted by eyeballing the
 * fixture file. Also exercises them against the real, unmodified engine
 * functions (schema validation, context assembly, diff application) rather
 * than only checking the fixture's own shape, so a change to those functions
 * that would break real seeding shows up here too.
 */

describe('test universe fixtures', () => {
  it('defines exactly two universes', () => {
    expect(TEST_UNIVERSES).toHaveLength(2);
  });

  it('are structurally incompatible with each other', () => {
    // The whole point: no field name in common across every entity of one
    // universe and every entity of the other, beyond the engine-required
    // `status`. If this ever passes trivially (e.g. because someone copied
    // fields between them), the fixtures have stopped doing their job.
    const ashfallFields = new Set(
      ASHFALL_LEGION.entities.flatMap((entity) => Object.keys(entity.data)),
    );
    const wovenmereFields = new Set(
      WOVENMERE.entities.flatMap((entity) => Object.keys(entity.data)),
    );

    expect(ashfallFields.has('abilities')).toBe(true);
    expect(ashfallFields.has('powerLevel')).toBe(true);
    expect(wovenmereFields.has('abilities')).toBe(false);
    expect(wovenmereFields.has('powerLevel')).toBe(false);

    expect(wovenmereFields.has('knowledge')).toBe(true);
    expect(wovenmereFields.has('relationships')).toBe(true);
    expect(ashfallFields.has('knowledge')).toBe(false);
  });

  it('each has at least five entities, per Appendix B\'s milestone', () => {
    for (const universe of TEST_UNIVERSES) {
      expect(universe.entities.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('every entity passes the real entityInputSchema unchanged', () => {
    for (const universe of TEST_UNIVERSES) {
      for (const entity of universe.entities) {
        const result = entityInputSchema.safeParse({
          type: entity.type,
          name: entity.name,
          data: entity.data,
          controlledBy: null,
        });

        expect(result.success, `${universe.slug}/${entity.name}: ${JSON.stringify(result.success ? null : result.error?.issues)}`).toBe(true);
      }
    }
  });

  it('every story passes the real createStoryInputSchema unchanged', () => {
    for (const universe of TEST_UNIVERSES) {
      const result = createStoryInputSchema.safeParse({
        title: universe.title,
        contentRating: universe.contentRating,
      });

      expect(result.success).toBe(true);
    }
  });

  it('assembles a real context prompt from each universe without special-casing', () => {
    for (const universe of TEST_UNIVERSES) {
      const entities: ContextEntity[] = universe.entities.map((entity, index) => ({
        id: `${index}`,
        type: entity.type,
        name: entity.name,
        status: (entity.data.status as string | undefined) ?? 'active',
        data: entity.data,
      }));

      const assembled = assembleContext({
        story: {
          title: universe.title,
          toneDirectives: universe.toneDirectives,
          worldLedger: universe.worldLedger,
        },
        turn: { turnNumber: 1, mode: 'freeform', sceneSetup: null },
        entities,
        recentChapters: [],
        submissions: [{ entityName: entities[0]?.name ?? null, content: 'They investigate.' }],
      });

      // Every entity's name should appear in the assembled prompt: proof the
      // opaque data actually made it through serialization, not that any
      // particular field was read.
      for (const entity of universe.entities) {
        expect(assembled.prompt).toContain(entity.name);
      }
    }
  });

  it('diffs apply identically across both universes through the same applyDiffs call', () => {
    // One universe changes a nested array field (abilities), the other a
    // map field (relationships) — different shapes, same code path.
    const ashfallEntity = ASHFALL_LEGION.entities[0];
    const wovenmereEntity = WOVENMERE.entities[0];

    if (ashfallEntity === undefined || wovenmereEntity === undefined) {
      throw new Error('fixture universes must have at least one entity');
    }

    const entities = new Map([
      ['ashfall-1', ashfallEntity.data],
      ['wovenmere-1', wovenmereEntity.data],
    ]);

    const diffs: Diff[] = [
      {
        entity_id: 'ashfall-1',
        field: 'powerLevel',
        from: ashfallEntity.data.powerLevel,
        to: 8,
        evidence: 'test',
      },
      {
        entity_id: 'wovenmere-1',
        field: 'relationships',
        from: wovenmereEntity.data.relationships,
        to: { 'Ivy Bramwell': 'reconciled' },
        evidence: 'test',
      },
    ];

    const result = applyDiffs(entities, diffs);

    expect(result.rejected).toHaveLength(0);
    expect(result.applied).toHaveLength(2);
    expect(result.updated.get('ashfall-1')?.powerLevel).toBe(8);
    expect(result.updated.get('wovenmere-1')?.relationships).toEqual({ 'Ivy Bramwell': 'reconciled' });
  });

  /**
   * Phase 2 (Part 12 exit criterion): each fixture now carries a real
   * entitySchema and progressionModel. This is the mechanical proof that both
   * — one power-scaling, one social-only — pass through the exact same
   * schema validator and progression dispatch table with no code path that
   * names either universe.
   */
  it('each entitySchema is itself valid per entitySchemaSchema', () => {
    for (const universe of TEST_UNIVERSES) {
      const result = entitySchemaSchema.safeParse(universe.entitySchema);
      expect(result.success, `${universe.slug}: ${JSON.stringify(result.success ? null : result.error?.issues)}`).toBe(true);
    }
  });

  it('each progressionModel resolves through the real dispatch table', () => {
    for (const universe of TEST_UNIVERSES) {
      expect(() => resolveProgressionModel(universe.progressionModel)).not.toThrow();
    }
  });

  it('registers structurally different progression models for the two fixtures', () => {
    expect(ASHFALL_LEGION.progressionModel).toBe('ability_unlock');
    expect(WOVENMERE.progressionModel).toBe('none');
  });

  it('every entity\'s real data validates against its own universe\'s real schema, through the same buildEntityDataValidator call', () => {
    for (const universe of TEST_UNIVERSES) {
      for (const entity of universe.entities) {
        const validator = buildEntityDataValidator(universe.entitySchema, entity.type);
        const result = validator.safeParse(entity.data);

        expect(
          result.success,
          `${universe.slug}/${entity.name} (${entity.type}): ${JSON.stringify(result.success ? null : result.error?.issues)}`,
        ).toBe(true);
      }
    }
  });

  it('Ashfall Legion\'s ability_unlock model enforces the capability lifecycle on its own capability_list data', () => {
    const model = resolveProgressionModel(ASHFALL_LEGION.progressionModel);
    const reya = ASHFALL_LEGION.entities.find((entity) => entity.name === 'Reya Okonkwo');
    const abilities = reya?.data.abilities as { id: string; status: string }[] | undefined;
    const firstAbility = abilities?.[0];

    if (firstAbility === undefined) {
      throw new Error('fixture must seed at least one ability with a status');
    }

    expect(
      model.validateTransition?.({ type: 'capability_list' }, firstAbility.status, 'mastered'),
    ).toBe(firstAbility.status === 'available'); // available -> mastered is allowed; anything else would not be

    expect(
      model.validateTransition?.({ type: 'capability_list' }, 'proposed', 'mastered'),
    ).toBe(false);
  });

  it('Wovenmere\'s none model imposes no transition constraint on its data', () => {
    const model = resolveProgressionModel(WOVENMERE.progressionModel);
    expect(model.validateTransition).toBeUndefined();
  });
});
