# universe-review

## Purpose

The human review UI and publish path that turns a research pipeline draft into an owner-approved, published universe: per-section accept/edit/reject, house rules, AU divergence marking, per-stage re-run with diffing, and the mapping into Phase 2's universe-versioning write path.

## Requirements

### Requirement: Section-by-section review
The review UI SHALL let the draft's owner accept, edit, or reject each section of the draft document independently, and SHALL display each fact's confidence level and source (when present) alongside it.

#### Scenario: Accept a section unchanged
- **WHEN** the owner accepts the Canonical Entities section without editing it
- **THEN** that section is marked accepted in the draft and its content is unchanged

#### Scenario: Edit a fact before accepting
- **WHEN** the owner edits a field within a section and accepts it
- **THEN** the edited value replaces the researched value in the draft, and the edit is attributed to the user rather than presented as researched output

#### Scenario: Reject a section
- **WHEN** the owner rejects a section
- **THEN** that section is excluded from the published universe version, and the draft records it as rejected rather than deleting the researched content

### Requirement: House rules and AU divergence
The owner SHALL be able to add freeform house rules not derived from research, and SHALL be able to mark any individual researched fact as an AU (alternate-universe) divergence without deleting the original canon fact.

#### Scenario: Add a house rule
- **WHEN** the owner enters freeform rule text and saves it
- **THEN** the rule is stored in the draft's rule pack with `source: 'user'`, distinct from rules with `source: 'research'`

#### Scenario: Mark a fact as AU
- **WHEN** the owner marks a canonical fact as AU and provides a divergence note
- **THEN** the fact retains its original researched value, gains `markedAu: true` and the divergence note, and downstream consumers (the published rule pack) treat the AU value as authoritative for this universe while the original remains visible for reference

### Requirement: Re-run with diff view
The owner SHALL be able to re-run any individual stage, and the review UI SHALL display a diff between that stage's previous output and its new output.

#### Scenario: Re-run a stage
- **WHEN** the owner requests a re-run of the Timeline & Canon State stage
- **THEN** that stage executes again using the same upstream stage outputs as input, and its prior output is retained as `previous_output` rather than discarded

#### Scenario: Diff is shown after re-run
- **WHEN** a re-run completes
- **THEN** the review UI shows what changed between `previous_output` and the new `output` for that stage

### Requirement: Publish draft to universe version
Publishing an accepted draft SHALL produce a Phase 2 universe and its first published version using the existing universe-versioning write path, without introducing a new persistence path for universes.

#### Scenario: Publish creates a universe version
- **WHEN** the owner publishes a draft with all required sections accepted
- **THEN** the accepted draft is mapped to a `UniverseVersionInput` and passed to the existing `createUniverse` function, producing an immutable version 1 exactly as Phase 2 defines

#### Scenario: Publish is blocked on required sections
- **WHEN** the owner attempts to publish a draft whose Schema Derivation section has been rejected
- **THEN** publishing is refused with an error identifying the missing required section, since a universe version cannot exist without an entity schema

#### Scenario: Published draft records its outcome
- **WHEN** a draft is successfully published
- **THEN** the `universe_drafts` row's status becomes `published` and it stores the resulting `universe_id` and version number, and the draft row itself is never deleted
