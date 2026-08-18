# research-pipeline

## Purpose

The 8-stage asynchronous job that turns a universe name (plus optional source materials) into a reviewable canon bible: Scoping, Rules & Mechanics, Power/Progression System, Canonical Entities, Timeline & Canon State, Schema Derivation, Rule Pack Generation, and Confidence & Gaps Report.

## Requirements

### Requirement: Eight-stage research pipeline
Given a universe name and optional source materials/canon cutoff/AU notes, the system SHALL run eight discrete stages in order — Scoping, Rules & Mechanics, Power/Progression System, Canonical Entities, Timeline & Canon State, Schema Derivation, Rule Pack Generation, Confidence & Gaps Report — each writing its output into a shared draft document, using the `researcher` model role for every generative stage.

#### Scenario: Stages run in dependency order
- **WHEN** a user submits a universe name to start research
- **THEN** Stage 1 (Scoping) completes before Stage 2 begins, and each subsequent stage's prompt includes the output of every stage it depends on

#### Scenario: Every stage call declares the researcher role
- **WHEN** any of the eight stages makes a model call
- **THEN** the call requests the `researcher` role and resolves its model from the owning user's default model config, and the response is parsed through a stage-specific Zod schema before being written to the draft

#### Scenario: Malformed stage output is retried once then typed as failed
- **WHEN** a stage's model response fails Zod validation
- **THEN** the gateway retries once with the validation error appended to the prompt, and if the second attempt also fails, the stage's `research_jobs` row is marked `failed` with the error recorded, and the pipeline proceeds to the next stage rather than halting

#### Scenario: Every stage call is billed and logged
- **WHEN** a stage's model call completes, fails validation, or fails the HTTP request
- **THEN** a `usage_log` row is written for that attempt, including attempts where validation failed after tokens were billed

### Requirement: Conditional Power/Progression stage
Stage 3 (Power/Progression System) SHALL run only when Stage 1's Scoping output reports `has_power_system: true` for this draft; when false, Stage 3 SHALL be recorded as skipped rather than executed with empty or placeholder input, and this SHALL be determined solely by that draft's own Stage 1 output, never by a hardcoded genre or universe name check.

#### Scenario: Power system present
- **WHEN** Stage 1 reports `has_power_system: true`
- **THEN** Stage 3 executes and its output is written to the draft's `progression` section

#### Scenario: No power system
- **WHEN** Stage 1 reports `has_power_system: false`
- **THEN** Stage 3's `research_jobs` row is set to `status: 'skipped'` with a null `output`, no model call is made for that stage, and Stage 6 (Schema Derivation) reads the skipped status rather than expecting progression data

### Requirement: Durable, resumable pipeline execution
The pipeline SHALL execute as a durable job such that a crash or restart after any completed stage resumes from the next incomplete stage rather than re-running completed stages, and progress SHALL be observable without polling.

#### Scenario: Resume after infrastructure restart
- **WHEN** the pipeline's execution environment restarts after Stage 4 has completed but before Stage 5 has started
- **THEN** on resumption Stage 5 runs next, and Stages 1–4 are not re-executed or re-billed

#### Scenario: Progress is streamed
- **WHEN** a stage transitions between `queued`, `running`, `complete`, `failed`, or `skipped`
- **THEN** the status change is visible to a subscribed client in real time without the client polling an endpoint

#### Scenario: One stage's failure does not abort the draft
- **WHEN** Stage 4 fails after exhausting its retry
- **THEN** Stages 5–8 still run using whatever output is available from prior stages, and Stage 8's Gaps Report explicitly lists Stage 4 as failed

### Requirement: Draft persistence and ownership
Research runs SHALL be persisted as a `universe_drafts` row (input, accumulating draft document, status) and one `research_jobs` row per stage, owned by the requesting user and readable only by that user, since a draft precedes any story or `story_members` row that could otherwise gate access.

#### Scenario: Draft visible only to its owner
- **WHEN** a user other than the draft's owner attempts to read a `universe_drafts` or `research_jobs` row
- **THEN** row-level security denies the read

#### Scenario: Draft accumulates across stages
- **WHEN** Stage 3 completes after Stages 1–2
- **THEN** the `universe_drafts` row's draft document contains Stage 1 and 2's sections unchanged plus Stage 3's new section

### Requirement: Confidence and gaps reporting
Every researched fact SHALL carry a confidence level, and Stage 8 SHALL produce a gaps report aggregating every low-confidence or unresolved item across all prior stages, including any stage that failed or was skipped.

#### Scenario: Fact carries confidence and optional source
- **WHEN** any stage other than Stage 8 emits a fact
- **THEN** that fact's record includes a `confidence` of `high`, `medium`, or `low`, and a `source` field when the research identified one

#### Scenario: Gaps report surfaces low-confidence facts
- **WHEN** Stage 8 runs
- **THEN** it lists every fact across Stages 1–7 with `confidence: 'low'`, plus any stage marked `failed` or `skipped`, in a single report attached to the draft
