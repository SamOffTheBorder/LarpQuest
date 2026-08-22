import 'server-only';

import { callStructured, StructuredOutputError, type BudgetGuard, type UsageRecorder } from '@/lib/ai/gateway';
import { gatekeeperVerdictSchema, type GatekeeperVerdict } from '@/lib/ai/gatekeeper-schema';
import type { ModelConfig } from '@/lib/ai/roles';
import { isSuppressed } from '@/lib/engine/rules/exceptions';
import type { CanonException, RuleEntity } from '@/lib/engine/rules/types';
import { serverEnv } from '@/lib/env';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { toJson } from '@/lib/supabase/json';

/**
 * The Gatekeeper (gatekeeper capability).
 *
 * Evaluates a player's proposal for something new — a capability, an
 * alliance, a plot development the entity does not yet have — against the
 * universe's rules, its active progression model, and the entity's current
 * state. Runs after context assembly and before the Narrator, so the
 * Narrator's prompt can reflect the ruling instead of assuming the proposal
 * simply succeeded (build plan 5.4; design.md Decision 4).
 *
 * Suppression reuses rules/exceptions.ts's isSuppressed, the same
 * scope-matching implementation the rule engine uses (design.md Decision 2)
 * — a `canon_exceptions` row created from a prior `reject` verdict must
 * suppress the same proposal shape identically to how it suppresses a
 * validator flag.
 */

export class GatekeeperOutputError extends Error {
  constructor(cause: unknown) {
    super('Gatekeeper model call failed to produce parseable output after retry.', { cause });
    this.name = 'GatekeeperOutputError';
  }
}

const GATEKEEPER_SYSTEM_PROMPT = [
  'You are the Gatekeeper for a collaborative fiction universe: a referee who',
  'rules on a player\'s request for something new — a capability, an alliance,',
  'a plot development their character does not yet have. You are not a',
  'yes-machine. Favor a cost or a limit over a flat rejection when the story',
  'is better for it, but do not let a player quietly power-creep past what',
  'this universe and this character\'s history actually support.',
  '',
  'Respond with a verdict of "allow", "allow_with_limits", or "reject", a',
  'short in-universe reasoning for your ruling, and — when relevant —',
  'imposed_limits (an array of constraints on how the capability may be',
  'used), a suggested_alternative, and a narrative_cost the character should',
  'pay for it.',
  '',
  'Respond with JSON only, matching the required schema exactly.',
].join('\n');

function buildGatekeeperPrompt(args: {
  proposal: string;
  progressionModel: string;
  universeRulesText: string;
  entity: RuleEntity;
}): string {
  return [
    `## Proposal\n${args.proposal}`,
    `## Progression model\n${args.progressionModel}`,
    `## Universe rules\n${args.universeRulesText}`,
    `## Proposing entity\n${JSON.stringify(args.entity)}`,
  ].join('\n\n');
}

export interface EvaluateProposalArgs {
  storyId: string;
  entityId: string | null;
  proposal: string;
  progressionModel: string;
  universeRulesText: string;
  entity: RuleEntity | null;
  canonExceptions: CanonException[];
  modelConfig: ModelConfig | null | undefined;
  usage: UsageRecorder;
  budget: BudgetGuard;
}

export interface ProposalRuling {
  verdict: GatekeeperVerdict;
  suppressed: boolean;
}

const SUPPRESSED_VERDICT: GatekeeperVerdict = {
  verdict: 'allow',
  reasoning: 'Previously excepted by the GM — not re-evaluated.',
};

/**
 * Evaluate one proposal and persist the resulting `proposals` row. A
 * proposal whose (rule id "gatekeeper", entity, capability) scope matches an
 * existing canon exception short-circuits to an `allow` verdict without a
 * model call — the same non-negotiable "never re-flag the same thing"
 * guarantee the rule engine gives validation flags (canon-exceptions
 * capability).
 */
export async function evaluateProposal(args: EvaluateProposalArgs): Promise<ProposalRuling> {
  const candidateFlag = {
    ruleId: 'gatekeeper.proposal',
    severity: 'block' as const,
    description: args.proposal,
    ...(args.entityId !== null ? { entityId: args.entityId } : {}),
  };

  const suppressed = isSuppressed(candidateFlag, args.canonExceptions);

  const verdict = suppressed
    ? SUPPRESSED_VERDICT
    : await runGatekeeperCall(args);

  await persistProposal(args, verdict);

  return { verdict, suppressed };
}

async function runGatekeeperCall(args: EvaluateProposalArgs): Promise<GatekeeperVerdict> {
  const entity = args.entity ?? { id: '', type: '', name: '(unclaimed entity)', status: 'active', data: {} };

  try {
    const { data } = await callStructured(
      { apiKey: serverEnv().OPENROUTER_API_KEY, usage: args.usage, budget: args.budget },
      {
        role: 'gatekeeper',
        modelConfig: args.modelConfig,
        systemPrompt: GATEKEEPER_SYSTEM_PROMPT,
        userPrompt: buildGatekeeperPrompt({
          proposal: args.proposal,
          progressionModel: args.progressionModel,
          universeRulesText: args.universeRulesText,
          entity,
        }),
        schema: gatekeeperVerdictSchema,
        storyId: args.storyId,
      },
    );

    return data;
  } catch (error) {
    if (error instanceof StructuredOutputError) {
      throw new GatekeeperOutputError(error);
    }

    throw error;
  }
}

async function persistProposal(args: EvaluateProposalArgs, verdict: GatekeeperVerdict): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('proposals').insert({
    story_id: args.storyId,
    entity_id: args.entityId,
    proposal: args.proposal,
    verdict: verdict.verdict,
    reasoning: verdict.reasoning,
    imposed_limits: verdict.imposed_limits === undefined ? null : toJson(verdict.imposed_limits),
    suggested_alternative: verdict.suggested_alternative ?? null,
    narrative_cost: verdict.narrative_cost ?? null,
  });

  if (error !== null) {
    throw new Error(`Failed to persist proposal: ${error.message}`);
  }
}
