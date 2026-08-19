---
sidebar_position: 7
title: Phase 6 — Validation & Gatekeeping
---

# Phase 6 — Validation & Gatekeeping

**Status:** Implemented
**Spec location:** `openspec/changes/phase-6-validation-gatekeeping/`

Phase 6 is build plan Part 5. Phase 5 (Multiplayer) is implemented and archived. Before this phase the turn loop went `locked` → `generating` → `published` with nothing in between: `universes.validation_rules` didn't exist as a column at all (Stage 7's research output was generated but never persisted), `chapters.validation_report` was a jsonb column no code populated, the `validator` and `gatekeeper` model roles existed but had no call site, and `submissions` had no way for a player to actually submit a proposal. A player could invent an unearned power and the Narrator would simply write it. Phase 6 closes that gap.

**Exit criteria:** A player proposing an unearned power gets a reasoned in-universe rejection.

## What shipped

- **Rule engine** — `applicableRules` (Standard Rule Pack + a universe's research-derived `validation_rules`, filtered by `applies_when.progression_model_in`) and `evaluateRules` (raw validator-call violations → suppression-filtered flags) are both pure functions with no model calls or DB access. Every rule carries `severity: block | warn | log`. Data-driven throughout — no branch on genre, universe, or media type.
- **Validator loop** — a new `validating` turn state between `generating` and `published`. The `validator` model role judges a chapter draft against every applicable rule in one call; `block` regenerates with the violation appended to the prompt, capped at 2 retries, then escalates to `failed` for the GM; `warn`/`log` publish with the flags recorded in `chapters.validation_report`.
- **Gatekeeper** — submissions gained an optional `proposal` field (stored as `submissions.proposals`, previously a schema-only column nothing wrote to). Each proposal is evaluated by the `gatekeeper` model role against universe rules, the active progression model, and the entity's current state, running *before* the Narrator so a `reject` or `allow_with_limits` verdict is reflected in the generated prose rather than the Narrator writing as if the ask simply succeeded. Every evaluated proposal is persisted to a new `proposals` table.
- **Canon exceptions (GM override)** — `overrideValidationFlag`/`overrideProposal`, `owner`/`gm` only, write a permanent `canon_exceptions` row from a validation flag or a Gatekeeper verdict. Never edit or delete the original flag or proposal — append-only, like `entity_history`. Scoped by rule + optional entity + optional capability, so an override can suppress narrowly or story-wide; both the rule engine and the Gatekeeper check this table (via one shared `isSuppressed` function) before re-flagging.
- **Consistency report** — `/stories/[storyId]/consistency`, a read-only per-chapter and per-story view of validation flags and proposal history, with an inline override button for `owner`/`gm`.

## What does not ship

Turn modes beyond `freeform` (Phase 7); any new progression model beyond the two Phase 2 shipped (`ability_unlock`, `none`) — the Gatekeeper and rule engine must work generically against whatever a universe has registered; billing/spend-cap UI beyond showing the new `usage_log` rows in existing cost views; any change to `assembleContext`'s signature or Phase 4's retrieval pipeline — the Gatekeeper ruling is a same-turn prompt input, not a stored context-pool source.

## Capabilities specified

| Capability | Covers |
|---|---|
| `rule-engine` | Standard Rule Pack + research-derived rule evaluation, filtered by applicability, `canon_exceptions` suppression |
| `validator-loop` | `validating` turn state, block/warn/log handling, retry-then-escalate, `validation_report` population |
| `gatekeeper` | Proposal evaluation, Zod-parsed verdict, `proposals` table, ruling injected into the Narrator prompt |
| `canon-exceptions` | GM/owner override, append-only, scoped suppression checked by both rule engine and Gatekeeper |
| `consistency-report` | Read-only per-chapter/per-story view with inline override |
| `turn-loop` (modified) | State machine gains `validating` between `generating` and `published` |

## Key design decisions

### `validating` is a first-class turn status, not a flag on `generating`

A dedicated status keeps the "what is this turn doing right now" property the state machine already has, and stays visible to Phase 5's realtime presence (which keys off `turns.status`) rather than making a block-triggered regeneration indistinguishable from a slow first draft.

### The rule engine is pure; the model call and the transition decision both live outside it

`evaluateRules({rules, violations, canonExceptions}) -> Flag[]` takes the validator model call's raw output as an argument rather than making the call itself — the model call lives in `ai/validator-call.ts`, and `validator.ts` orchestrates: call the model, hand its output to `evaluateRules`, then decide what to do about the highest severity present. This three-way split (pure filtering, model call, orchestration) is what makes the rule engine unit-testable without mocking the AI gateway. Suppression uses one scope-matching implementation (`rules/exceptions.ts`'s `isSuppressed`) shared by the rule engine and the Gatekeeper, so their suppression semantics can't drift apart.

### The Gatekeeper runs before the Narrator, on the same turn

The exit criterion requires the rejection to show up *in the prose*, not as a flag bolted on after the fact. So proposal evaluation is a new step between context assembly and generation, and its verdict is threaded into that turn's Narrator prompt the same way Phase 5 threads in `conflict_policy`.

### `canon_exceptions` scope is a superset of the build-plan sketch

The build plan's schema is `rule_id` + `exception_note`. This phase adds nullable `entity_id` and `capability_id` so an override can be scoped to one specific entity/capability combination rather than only "disable this rule for the whole story." A row with both null is still a valid story-wide exception — the minimal build-plan shape keeps working.

### Research's rule pack was generated but never persisted — fixed as part of this phase

The rule engine's design assumed `universe_versions.validation_rules` already existed. It didn't: the column had never been migrated, and while the research pipeline's Stage 7 (`rulePackResultSchema`) has generated a rule pack since Phase 3, `publish.ts` dropped it on the floor rather than writing it onto a published universe version. Fixed in this phase — `validation_rules jsonb not null default '[]'` added to `universe_versions`, threaded through `createUniverse`/`publishUniverseVersion`, and `draftToUniverseVersionInput` now maps an accepted rule-pack draft section into it. `rulePackResultSchema` also gained the `applies_when` field the rule engine's `applies_when.progression_model_in` filtering needs, which was likewise missing.

## Database objects

New: `proposals` (story_id, entity_id, proposal, verdict, reasoning, imposed_limits, suggested_alternative, narrative_cost, gm_override), `canon_exceptions` (story_id, rule_id, entity_id, capability_id, exception_note, created_by). Widened: `turns.status` check constraint gains `'validating'`; `universe_versions` gains `validation_rules jsonb`; `publish_chapter`'s guard moves from `generating` to `validating` and gains a `p_validation_report` parameter. Newly populated: `chapters.validation_report`.

→ [Full data model](/reference/data-model)

## Verifying the phase

- `engine/rule-engine.test.ts` — Standard Rule Pack rules present/absent by progression model; research-derived rule filtered by `applies_when`; suppression (story-wide and entity-scoped); pure-function determinism
- `engine/validator.test.ts` — no-flags publishes; block retries under the cap and fails once exceeded; a canon-exception-suppressed violation does not block
- `engine/gatekeeper.test.ts` — verdict persisted; malformed output retries then raises a typed error; suppressed proposal skips the model call; same code path for an `ability_unlock` and a `none`-model entity
- `engine/canon-exceptions.test.ts` — override writes an exception without touching the source row; empty reason and non-owner/GM both rejected; a written exception suppresses a later matching flag or proposal
- `engine/consistency-report.test.ts` — flagged vs. clean vs. unevaluated chapter reports; proposal history including override state
- `engine/phase-6-exit-criterion.test.ts` — the full arc: propose → reasoned rejection → visible in the report → GM override → not re-rejected
- `npm test` (338/338 passing), `npm run typecheck`, `npm run build` all pass from `apps/web`; `supabase db advisors --linked` and the RLS coverage test both clean after every migration

## Working the phase

```bash
openspec show phase-6-validation-gatekeeping
openspec status --change phase-6-validation-gatekeeping
openspec validate phase-6-validation-gatekeeping --strict
```

→ [Spec workflow](/reference/spec-workflow)
→ [Validation & Gatekeeping architecture](/architecture/validation-gatekeeping)
