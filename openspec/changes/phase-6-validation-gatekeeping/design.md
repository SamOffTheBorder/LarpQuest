## Context

The turn state machine lives in exactly one place, `apps/web/src/lib/engine/turn-state.ts`: a `TRANSITIONS` table plus `assertTransition`, mirrored by a `check` constraint on `turns.status` in `supabase/migrations/20260812000003_turns_and_submissions.sql` and a partial unique index enforcing at most one live (non-`published`) turn per story. Today the chain is `open → locked → generating → published`, with `generating → failed → generating` for retry. Nothing sits between `generating` and `published` — a chapter that finishes generation is published immediately.

`universes.validation_rules` (Stage 7 research output) and `chapters.validation_report` (jsonb) exist in the schema but are dead columns — no code reads or writes them. The `validator` and `gatekeeper` roles are declared in `apps/web/src/lib/ai/roles.ts` with defaults resolved, but no call site uses either. `submissions.proposals` is captured from players but never evaluated. The `proposals` and `canon_exceptions` tables from build-plan Part 8.2 have never been migrated.

The `ability_unlock` progression model (`apps/web/src/lib/engine/progression-models.ts`, per `openspec/specs/progression-models/spec.md`) already enforces its own status-lifecycle transitions (`proposed → developing → available → mastered | lost | sealed`) at the entity write path. This phase does not change that enforcement; it adds a second, narrative-facing check — whether a chapter's prose or a player's proposal is consistent with the entity state as of the start of the turn, which the write-path lifecycle check cannot see because it only runs when a field is actually written.

## Goals / Non-Goals

**Goals:**
- Insert a `validating` state into the turn machine that runs the rule engine against a generated chapter draft before publication, with `block` severity able to force regeneration and `warn`/`log` able to publish-with-flag.
- Give proposals (from `submissions.proposals`) a real evaluation path through the `gatekeeper` role, persisted to a new `proposals` table, with the ruling visible to the Narrator on the same turn.
- Give GM/owner a durable, narrowly-scoped override that survives future turns without needing to be re-clicked.
- Do all of the above through data (`validation_rules`, `progression_models`, `canon_exceptions` rows) rather than new conditionals on genre/universe/media type.

**Non-Goals:**
- Not touching extraction, memory, or context-assembly signatures — the Gatekeeper ruling is an additional prompt input for the current turn only, not a stored context-pool source.
- Not implementing any turn mode beyond `freeform`.
- Not adding new progression models.
- Not changing how `ability_unlock` enforces its own field-level lifecycle transitions.

## Decisions

### 1. `validating` as a first-class turn status, not a sub-state of `generating`

Adding `validating` to `TURN_STATUSES` and the `turns.status` check constraint, with transitions `generating → validating`, `validating → published`, `validating → generating` (block-severity retry, `attempt_count` already exists and is reused), `validating → failed` (retry exhaustion escalation). This keeps the single-source-of-truth property the existing state machine already has — a status column readers can query directly ("is anything in this story mid-validation?") — rather than overloading `generating` with a boolean flag that every reader would need to know about.

Alternative considered: keep validation inside the `generating` status and only expose it through `chapters.validation_report` once published. Rejected — it would make a `block`-triggered regeneration invisible to realtime presence/UI (Phase 5's presence channel already keys off `turns.status`), and it would mean a chapter could sit "generating" for the duration of up to 3 model calls (narrator + validator + narrator retry) with no observable distinction from a slow first draft.

### 2. Rule engine is a pure function; `canon_exceptions` lookup happens inside it, not around it

`evaluateRules(chapterDraft, universeVersion, entities, canonExceptions) -> Flag[]` takes the already-fetched `canon_exceptions` rows as an argument and filters them out internally, rather than having callers pre-filter. This keeps exactly one place that knows how an exception's scope (rule + entity + capability) matches a candidate flag, so the Gatekeeper's suppression check and the validator's suppression check can't drift apart into two different matching semantics.

Standard Rule Pack entries (5.2) are engine-provided TypeScript objects with the same shape as a research-derived rule (`{id, source: 'engine', applies_when, check, severity}`), concatenated with `universeVersion.validation_rules` before evaluation. A universe can disable a specific engine rule by writing a `canon_exceptions` row scoped to that rule id with no entity/capability restriction — this reuses the override mechanism rather than adding a second "disabled rules" list.

### 3. Severity handling lives in the validator orchestrator, not the rule engine

`evaluateRules` only classifies; it never decides to retry or publish. `apps/web/src/lib/engine/validator.ts` owns: call `evaluateRules`, branch on the highest severity present (`block` > `warn` > `log`), and drive the turn transition. This split matches the existing `progression-models` dispatch pattern (resolve, then act) and keeps `evaluateRules` testable as pure input→output without mocking the turn state machine.

### 4. Gatekeeper ruling is injected into the Narrator prompt for the same turn, not stored as new context-pool state

When a submission carries a `proposals` payload, the Gatekeeper runs *before* the Narrator (new step between ASSEMBLE and GENERATE, per Part 1.2's turn loop numbering — the Gatekeeper needs to have ruled before the Narrator writes prose that assumes the outcome). Its `{verdict, reasoning, imposed_limits, suggested_alternative, narrative_cost}` is appended to the same turn's prompt payload, the same way conflict-resolution policy is threaded in per the Phase 5 design. It is not written into `assembleContext`'s ALWAYS/RECENT/RETRIEVED sections — those are Phase 4's concern and this phase does not touch them. Past rulings remain retrievable via the `proposals` table for the consistency report, but retrieval into future turns' context is out of scope (a future phase could add "precedent" retrieval; this phase does not).

Alternative considered: run the Gatekeeper as a post-hoc check alongside the rule engine, after the Narrator writes. Rejected — the build plan's exit criterion is "a player proposing an unearned power gets a reasoned in-universe rejection," which requires the rejection to be reflected *in the prose itself* (the Narrator writing the character failing/being refused), not just a flag bolted on after generation.

### 5. `proposals` and `canon_exceptions` follow the Part 8.2 schema as-specified, scoped via `story_id`

Both tables get `story_id` (not `universe_id`) as their RLS anchor, consistent with every other Phase 1–5 table, gated through `is_story_member`/`is_story_owner`/`is_gm` helpers already established in `apps/web/src/lib/engine/membership.ts`. `canon_exceptions.exception_note` is required free text (the GM's stated reason) per 5.5's "must remember it" framing — an override with no reasoning recorded is hard to audit later.

`canon_exceptions` needs a `scope` beyond the Part 8.2 minimal shape (`rule_id`, `exception_note`) to support "this specific entity + capability combination," not "this rule for the whole story": add nullable `entity_id` and `capability_id` (text, matches a capability's `id` inside a `capability_list` field) columns. A row with both null means "suppress this rule story-wide" (the engine-rule-disable case in Decision 2); a row with either set narrows the suppression. This is a superset of the build-plan's schema, not a deviation from it — the build plan's `rule_id` + `exception_note` are both present.

### 6. Failure behavior

- **Validator timeout or gateway error**: treated as a `failed` model call like any other role — one retry, then the turn transitions `validating → failed` with `failure_reason` set, same as an exhausted block-severity retry. Validation failure never silently publishes, since that would defeat the gate.
- **Validator output fails Zod parse**: one retry with the parse error appended to the prompt (matches CLAUDE.md rule 7); second failure raises a typed `ValidatorOutputError` and the turn goes to `failed`.
- **Gatekeeper output fails Zod parse**: same one-retry-then-typed-error pattern. If the Gatekeeper call fails entirely (not just malformed output) after retry, the turn also goes to `failed` rather than silently skipping the proposal — a proposal that couldn't be ruled on must not reach the Narrator un-adjudicated, since that reopens the exact gap this phase closes.
- **Block-severity retry exhaustion (2 retries)**: turn transitions to `failed`, `failure_reason` names the rule(s) that kept blocking, and the existing GM-facing failed-turn UI (Phase 1) surfaces it. The GM can override (writing a `canon_exceptions` row) and retry, or edit the chapter draft manually — both reuse existing `failed → generating` retry.
- **Every validator and gatekeeper call writes `usage_log`** regardless of outcome, including calls that fail after tokens were billed, per CLAUDE.md rule 8 and the existing pattern in `apps/web/src/lib/ai/gateway.ts`.

## Risks / Trade-offs

- **Extra model calls per turn (validator always; gatekeeper when a proposal exists) increase latency and cost.** → Validator uses the cheap/fast tier by default (`DEFAULT_MODELS.validator = haiku-4.5`, already set); Gatekeeper only runs when `submissions.proposals` is non-empty for the turn, not on every turn.
- **A block-severity rule that is subtly wrong could deadlock ordinary turns in a retry-then-fail loop.** → Retry cap of 2 (matches existing pattern) plus GM override path; `log`/`warn` remain the default severity for anything not in the engine-provided Standard Rule Pack unless research explicitly marks it `block`, so a bad research-derived rule degrades to visible-but-non-blocking rather than freezing the story.
- **`canon_exceptions` scope (entity_id/capability_id) adds columns beyond the Part 8.2 sketch.** → Documented in Decision 5; both are nullable and the minimal build-plan shape (rule_id + exception_note, both null scope columns) remains a valid row.
- **Injecting the Gatekeeper ruling into the Narrator prompt couples turn generation to proposal evaluation, adding a sequential model call (Gatekeeper) before the Narrator can start.** → Only on turns with a proposal; unavoidable given the exit criterion requires the rejection to show up in-fiction, not as a post-hoc flag.

## Migration Plan

1. Migration: `proposals` and `canon_exceptions` tables + RLS (additive, no existing table altered).
2. Migration: add `'validating'` to the `turns.status` check constraint (additive to the check's `in (...)` list — existing rows unaffected since none currently hold that value).
3. Deploy `rule-engine.ts`, `validator.ts`, `gatekeeper.ts`, `canon-exceptions.ts` and wire `validator.ts` into the existing generation-completion call site behind the new transition — no behavior change for a story until the first chapter finishes generating post-deploy.
4. No backfill needed: `chapters.validation_report` and `proposals` start populating only for turns generated after deploy; historical chapters remain `null`/absent, which the consistency report treats as "not evaluated" rather than "passed."
5. Rollback: revert the code deploy; the added migrations are additive (new tables, widened check constraint) and safe to leave in place even if the code is rolled back, since no code path writes `'validating'` without the corresponding orchestrator.

## Open Questions

- Should `warn`-severity flags be dismissible by GM without creating a `canon_exceptions` row (a lighter "acknowledge" vs. the heavier "except permanently")? Leaning toward: dismiss is UI-only (marks the flag seen in `validation_report`), and only a repeat/permanent suppression needs `canon_exceptions` — deferred to task-level implementation detail rather than blocking this design.
- Whether `capability_id` scoping on `canon_exceptions` needs to extend to other primitive types (`resource`, `relationship_map`) for non-`ability_unlock` universes proposing e.g. a reputation swing. Current design scopes narrowly to capabilities since that's the build plan's explicit example (5.4/5.5); broadening is additive and can follow if Phase 6 implementation surfaces a concrete case.
