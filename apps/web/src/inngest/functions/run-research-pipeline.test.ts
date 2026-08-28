import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * End-to-end proof of the exit criterion (build plan Part 10): submitting a
 * universe name drives all eight stages to resolution (complete or skipped)
 * and produces a non-empty gaps report, without any stage throwing past the
 * orchestrator.
 *
 * This drives the real exported Inngest function (`runResearchPipeline.fn`,
 * the raw handler the SDK wraps) against a fake `step` whose `run(id, cb)`
 * just awaits `cb()` — equivalent to a single successful pass with no crash
 * to resume from, which is what "step.run gives per-step retry and
 * memoization" reduces to on the happy path. The gateway, database, and
 * Inngest client are mocked; nothing here makes a network call or needs a
 * live signed-in session, which this environment cannot provide.
 */

const state = vi.hoisted(() => ({
  drafts: new Map<string, Record<string, unknown>>(),
  jobs: new Map<string, Record<string, unknown>>(),
  usageCalls: [] as unknown[],
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/ai/api-key', () => ({
  resolveStoryApiKey: async () => ({ key: 'test-key', source: 'platform' }),
  resolvePlatformApiKey: () => ({ key: 'test-key', source: 'platform' }),
}));

vi.mock('@/lib/env', () => ({
  serverEnv: () => ({ OPENROUTER_API_KEY: 'test-key' }),
  clientEnv: {},
}));

vi.mock('@/lib/ai/usage', () => ({
  createUsageRecorder: () => ({
    record: async (entry: unknown) => {
      state.usageCalls.push(entry);
    },
  }),
}));

// One canned, schema-valid response per stage. callStructured is mocked at
// the gateway boundary — exactly like extraction-worker.test.ts's precedent
// — so every stage's real Zod schema still validates the mocked output.
const STAGE_RESPONSES: Record<string, unknown> = {
  scoping: {
    media_type: { value: 'manga', confidence: 'high' },
    genre_tags: { value: ['shonen'], confidence: 'high' },
    has_power_system: { value: true, confidence: 'high' },
    scale_ceiling: { value: 'planetary', confidence: 'medium' },
    primary_conflict_mode: { value: 'combat', confidence: 'high' },
    tone: { value: ['dark', 'escalating'], confidence: 'medium' },
    recommended_turn_modes: { value: ['action'], confidence: 'high' },
  },
  rules_mechanics: {
    rules: [{ id: 'r1', description: { value: 'No FTL travel.', confidence: 'high' } }],
  },
  progression: {
    acquisition: { value: 'Training and awakening.', confidence: 'medium' },
    limits: { value: 'Cursed energy exhaustion.', confidence: 'medium' },
    scaling: { value: 'Grade-based.', confidence: 'high' },
    tiers: { value: ['Grade 4', 'Grade 1', 'Special Grade'], confidence: 'high' },
    known_ceiling: { value: 'Special Grade sorcerer.', confidence: 'low' },
  },
  entities: {
    entities: [
      {
        name: 'Protagonist',
        role: { value: 'lead', confidence: 'high' },
        capabilities: { value: ['cursed technique'], confidence: 'medium' },
        status_at_cutoff: { value: 'alive', confidence: 'high' },
        key_relationships: { value: ['mentor'], confidence: 'low' },
      },
    ],
  },
  timeline: {
    starting_point: { value: 'Series start.', confidence: 'high' },
    established_events: { value: ['inciting incident'], confidence: 'medium' },
    unresolved_threads: { value: ['antagonist whereabouts'], confidence: 'low' },
  },
  schema_derivation: {
    entity_schema: {
      entity_types: {
        character: {
          label: 'Character',
          fields: [{ key: 'name', type: 'string', required: true }],
        },
      },
    },
    progression_model: 'ability_unlock',
    progression_config: {},
  },
  rule_pack: {
    rules: [{ id: 'rp1', source: 'research', check: 'No unexplained power jumps.', severity: 'warn' }],
  },
};

vi.mock('@/lib/ai/gateway', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/gateway')>('@/lib/ai/gateway');

  return {
    ...actual,
    callStructured: async (
      deps: { usage: { record: (e: unknown) => Promise<void> } },
      args: { role: string; schema: { parse: (v: unknown) => unknown } },
    ) => {
      await deps.usage.record({ role: args.role, succeeded: true });

      // Reverse-engineer which stage this is from the schema by trying the
      // canned responses — simplest way to route without threading stage
      // through callStructured's args, which real call sites don't do either.
      for (const candidate of Object.values(STAGE_RESPONSES)) {
        try {
          const data = args.schema.parse(candidate);
          return { data, resolvedModel: 'test/model', usedFallbackModel: false };
        } catch {
          continue;
        }
      }

      throw new Error('No canned response matched this stage schema.');
    },
  };
});

vi.mock('@/inngest/client', () => ({
  inngest: {
    createFunction: (opts: unknown, handler: unknown) => ({ opts, fn: handler }),
  },
}));

vi.mock('@/lib/supabase/server', () => {
  function draftsTable() {
    const filters: Record<string, unknown> = {};
    const chain = {
      select() {
        return chain;
      },
      eq(column: string, value: unknown) {
        filters[column] = value;
        return chain;
      },
      async single() {
        const row = state.drafts.get(filters.id as string);
        return row === undefined ? { data: null, error: { message: 'not found' } } : { data: row, error: null };
      },
      update(patch: Record<string, unknown>) {
        return {
          async eq(_col: string, value: unknown) {
            const existing = state.drafts.get(value as string);
            if (existing !== undefined) state.drafts.set(value as string, { ...existing, ...patch });
            return { error: null };
          },
        };
      },
    };
    return chain;
  }

  function jobsTable() {
    const filters: Record<string, unknown> = {};
    const chain = {
      select() {
        return chain;
      },
      eq(column: string, value: unknown) {
        filters[column] = value;
        return chain;
      },
      update(patch: Record<string, unknown>) {
        const updateFilters: Record<string, unknown> = { ...filters };
        return {
          eq(column: string, value: unknown) {
            updateFilters[column] = value;
            return this;
          },
          then(resolve: (v: { error: null }) => void) {
            const key = `${updateFilters.draft_id}:${updateFilters.stage}`;
            const existing = state.jobs.get(key);
            if (existing !== undefined) state.jobs.set(key, { ...existing, ...patch });
            resolve({ error: null });
          },
        };
      },
      then(resolve: (v: { data: unknown[]; error: null }) => void) {
        const rows = [...state.jobs.values()].filter((row) => row.draft_id === filters.draft_id);
        resolve({ data: rows, error: null });
      },
    };
    return chain;
  }

  function from(table: string) {
    if (table === 'universe_drafts') return draftsTable();
    if (table === 'research_jobs') return jobsTable();
    throw new Error(`unexpected table ${table}`);
  }

  return {
    createServiceRoleClient: () => ({
      from,
      rpc: async (name: string, args: { p_draft_id: string; p_stage: string }) => {
        if (name === 'start_research_job') {
          const key = `${args.p_draft_id}:${args.p_stage}`;
          const existing = state.jobs.get(key);
          if (existing !== undefined) {
            state.jobs.set(key, { ...existing, status: 'running', attempt_count: ((existing.attempt_count as number) ?? 0) + 1 });
          }
        }
        return { data: null, error: null };
      },
    }),
  };
});

const { runResearchPipeline } = await import('@/inngest/functions/run-research-pipeline');

const ALL_STAGES = [
  'scoping',
  'rules_mechanics',
  'progression',
  'entities',
  'timeline',
  'schema_derivation',
  'rule_pack',
  'gaps',
];

function fakeStep() {
  return {
    run: async (_id: string, cb: () => unknown) => cb(),
  };
}

beforeEach(() => {
  state.drafts.clear();
  state.jobs.clear();
  state.usageCalls.length = 0;
});

describe('runResearchPipeline (exit criterion)', () => {
  it('drives all eight stages to resolution and produces a non-empty gaps report', async () => {
    const draftId = 'draft-jjk';
    state.drafts.set(draftId, {
      id: draftId,
      owner_id: 'user-1',
      status: 'researching',
      input: { name: 'Jujutsu Kaisen' },
      draft: {},
    });

    for (const stage of ALL_STAGES) {
      state.jobs.set(`${draftId}:${stage}`, { draft_id: draftId, stage, status: 'queued' });
    }

    const handler = (runResearchPipeline as unknown as { fn: (args: unknown) => Promise<unknown> }).fn;
    const result = await handler({
      event: { name: 'research/draft.requested', data: { draftId } },
      step: fakeStep(),
    });

    expect(result).toEqual({ draftId, status: 'ready_for_review' });

    const finalDraft = state.drafts.get(draftId);
    expect(finalDraft?.status).toBe('ready_for_review');

    // Every stage resolved — none left queued or running.
    const jobStatuses = [...state.jobs.values()].map((job) => job.status);
    expect(jobStatuses.every((status) => status === 'complete' || status === 'skipped')).toBe(true);
    expect(jobStatuses).toHaveLength(8);

    const draftDoc = finalDraft?.draft as Record<string, unknown>;
    const gaps = draftDoc.gaps as { content: { low_confidence_facts: unknown[]; unresolved_stages: unknown[] } };

    // Non-empty gaps report: the canned fixtures include several
    // confidence: 'low' facts (e.g. progression's known_ceiling, entities'
    // key_relationships), so the report has real content, not an empty shell.
    expect(gaps.content.low_confidence_facts.length).toBeGreaterThan(0);

    // Every model call recorded usage, success included.
    expect(state.usageCalls.length).toBeGreaterThanOrEqual(7); // 7 model-calling stages; gaps is derived
  });

  it('continues past a failed stage and reports it in the gaps report', async () => {
    const draftId = 'draft-fail';
    state.drafts.set(draftId, {
      id: draftId,
      owner_id: 'user-1',
      status: 'researching',
      input: { name: 'Broken Universe' },
      draft: {},
    });

    for (const stage of ALL_STAGES) {
      state.jobs.set(`${draftId}:${stage}`, { draft_id: draftId, stage, status: 'queued' });
    }

    // Remove the entities fixture so that stage's schema.parse never matches
    // any canned response, forcing runStage into a failed outcome.
    const original = STAGE_RESPONSES.entities;
    delete STAGE_RESPONSES.entities;

    try {
      const handler = (runResearchPipeline as unknown as { fn: (args: unknown) => Promise<unknown> }).fn;
      const result = await handler({
        event: { name: 'research/draft.requested', data: { draftId } },
        step: fakeStep(),
      });

      expect(result).toEqual({ draftId, status: 'ready_for_review' });

      const entitiesJob = state.jobs.get(`${draftId}:entities`);
      expect(entitiesJob?.status).toBe('failed');

      // Downstream stages still ran despite the failure.
      const timelineJob = state.jobs.get(`${draftId}:timeline`);
      expect(timelineJob?.status).toBe('complete');

      const finalDraft = state.drafts.get(draftId);
      const draftDoc = finalDraft?.draft as Record<string, unknown>;
      const gaps = draftDoc.gaps as { content: { unresolved_stages: { stage: string; status: string }[] } };

      expect(gaps.content.unresolved_stages).toContainEqual(
        expect.objectContaining({ stage: 'entities', status: 'failed' }),
      );
    } finally {
      STAGE_RESPONSES.entities = original;
    }
  });
});
