## ADDED Requirements

### Requirement: GM/owner override writes a permanent canon exception
A user holding role `owner` or `gm` SHALL be able to override a validation flag (from `chapters.validation_report`) or a Gatekeeper verdict (`reject` or `allow_with_limits`) with a single action that writes a new `canon_exceptions` row. This action MUST NOT edit or delete the original flag or `proposals` row — the override is an additional, append-only record, matching the non-destructive pattern used by `entity_history`.

#### Scenario: Override on a validation flag
- **WHEN** a `gm` overrides a `block` or `warn` flag on a chapter's `validation_report`
- **THEN** a `canon_exceptions` row is written and the original `validation_report` entry remains unchanged

#### Scenario: Override on a Gatekeeper verdict
- **WHEN** an `owner` overrides a `reject` verdict on a `proposals` row
- **THEN** a `canon_exceptions` row is written, and the `proposals` row's `gm_override` field is set true without altering its `verdict` or `reasoning`

#### Scenario: Player cannot override
- **WHEN** a user with role `player` or `spectator` attempts the override action
- **THEN** the system SHALL reject the request

### Requirement: Override requires a stated reason
Writing a `canon_exceptions` row SHALL require a non-empty `exception_note` supplied by the acting user. The system MUST reject an override attempt with no reason given.

#### Scenario: Override with reason succeeds
- **WHEN** a `gm` submits an override with a non-empty `exception_note`
- **THEN** the `canon_exceptions` row is written including that note

#### Scenario: Override with empty reason rejected
- **WHEN** a `gm` submits an override with an empty or whitespace-only `exception_note`
- **THEN** the system SHALL reject the request

### Requirement: Exception scope
A `canon_exceptions` row SHALL record `rule_id` and MAY record a nullable `entity_id` and nullable `capability_id` to narrow its scope. A row with both null applies to the rule for the entire story; a row with either set applies only to flags matching that entity and/or capability.

#### Scenario: Story-wide exception
- **WHEN** a `canon_exceptions` row is created with `entity_id` and `capability_id` both null
- **THEN** future evaluation of that `rule_id` is suppressed for every entity and capability in the story

#### Scenario: Narrowly scoped exception
- **WHEN** a `canon_exceptions` row is created with a specific `entity_id` and `capability_id`
- **THEN** future evaluation of that `rule_id` is suppressed only for that entity/capability combination, and the rule still evaluates normally elsewhere

### Requirement: Exceptions checked before re-flagging
Both the rule engine (`rule-engine` capability) and the Gatekeeper (`gatekeeper` capability) MUST check a story's `canon_exceptions` rows before emitting a flag or evaluating a proposal that would otherwise repeat a prior rejection, and MUST suppress the match rather than re-flagging it.

#### Scenario: Same violation never re-flagged after override
- **WHEN** a chapter draft in a later turn would trigger the same rule against the same entity and capability an exception already covers
- **THEN** the rule engine does not emit that flag

#### Scenario: Gatekeeper does not re-reject an excepted proposal
- **WHEN** a later proposal matches the scope of an existing `canon_exceptions` row created from a prior `reject` verdict
- **THEN** the Gatekeeper's evaluation for that proposal treats it as already permitted rather than issuing the same rejection again

### Requirement: Canon exceptions RLS
`canon_exceptions` rows SHALL be readable by any member of the owning story and writable only by users holding role `owner` or `gm` for that story, gated through `story_members`.

#### Scenario: Member can read exceptions
- **WHEN** any member of a story queries its `canon_exceptions`
- **THEN** the rows are returned

#### Scenario: Non-member cannot read or write
- **WHEN** a user who is not a member of the story attempts to read or write a `canon_exceptions` row for it
- **THEN** the request is rejected by RLS
