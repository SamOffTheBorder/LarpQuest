## ADDED Requirements

### Requirement: Premise intent capture
The system SHALL let an authenticated user describe the story they want before any story exists, using a freeform pitch together with optional guided fields. Every guided field MUST accept open-ended text or a number; the system MUST NOT present a fixed list of genres, media types, or universes as the source of that intent, and MUST NOT persist or pass downstream any genre token derived from such a list.

#### Scenario: Intent submitted with a pitch alone
- **WHEN** a user submits a freeform pitch and a content rating, leaving every optional field blank
- **THEN** the system creates a premise draft owned by that user, stores the intent, and begins generation

#### Scenario: Intent submitted with guided fields
- **WHEN** a user fills the setting sketch, tone notes, must-include, must-avoid, and cast size fields alongside the pitch
- **THEN** all supplied values are stored on the draft as free text or numbers and passed to generation as context

#### Scenario: Neither pitch nor setting supplied
- **WHEN** a user submits with both the pitch and the setting sketch empty
- **THEN** the system rejects the submission with a validation error and creates no draft and no model call

#### Scenario: Cast size outside the supported range
- **WHEN** a user submits a cast size below 1 or above 8
- **THEN** the system rejects the submission with a validation error and creates nothing

#### Scenario: Intent survives a failed generation
- **WHEN** generation fails after the intent was submitted
- **THEN** the stored intent is unchanged and the user can retry without re-entering any field

### Requirement: Premise generation
The system SHALL generate a premise by calling the `premise` model role, and MUST parse the response through a Zod schema before persisting it. The generated premise SHALL be a sectioned document containing a TLDR, a setting, an opening situation, a cast, story hooks, and tone guidance, each section carrying an independent review status.

#### Scenario: Premise generated successfully
- **WHEN** generation completes and the response validates
- **THEN** every section is persisted with status `pending`, and the draft becomes reviewable

#### Scenario: Model call declares its role
- **WHEN** the system generates a premise
- **THEN** it requests the `premise` role and resolves the model string through the role table rather than naming a model at the call site

#### Scenario: Usage recorded
- **WHEN** a premise generation call completes, whether it succeeds or fails after tokens were billed
- **THEN** a `usage_log` row is written recording the role, resolved model, tokens, and cost

#### Scenario: Malformed model output
- **WHEN** the model returns output that fails schema validation
- **THEN** the system retries once with the validation error appended, and on a second failure raises a typed error and leaves the draft in its prior state

#### Scenario: Generation fails on transport or timeout
- **WHEN** the model call times out or the transport fails
- **THEN** the draft is left untouched, no partial premise is persisted, and the error is surfaced as retryable

#### Scenario: Universe-pinned generation
- **WHEN** the intent names a published universe
- **THEN** that universe's Canon Bible is supplied as generation context, and the premise is written to sit inside it

### Requirement: Per-section premise review
A draft owner SHALL be able to review each premise section independently, marking it accepted, rejected, or edited, and MAY record freeform notes covering the premise as a whole. An edit MUST be attributed to the user rather than presented as generated content.

#### Scenario: Section accepted
- **WHEN** the owner accepts a section
- **THEN** that section's status becomes `accepted` and its content is unchanged

#### Scenario: Section rejected
- **WHEN** the owner rejects a section
- **THEN** that section's status becomes `rejected` and its generated content is retained rather than deleted

#### Scenario: Section edited
- **WHEN** the owner replaces a section's text with their own
- **THEN** the section's status becomes `edited`, the replacement is stored separately from the generated content, and the original generated content remains recoverable

#### Scenario: Notes recorded
- **WHEN** the owner writes freeform feedback on the premise
- **THEN** the notes are stored on the draft and applied to the next regeneration

#### Scenario: Non-owner attempts review
- **WHEN** a user who does not own the draft attempts to accept, reject, edit, or add notes
- **THEN** the request fails with the same not-found response a nonexistent draft returns

### Requirement: Cast members are reviewed individually
The cast section SHALL support keeping or cutting each member independently, in addition to the section-level review every section supports. A cut member MUST be retained in the stored section rather than deleted, so the cut can be reversed and so regeneration can avoid reproposing it.

#### Scenario: One cast member cut
- **WHEN** the owner cuts one member of a three-member cast
- **THEN** the other two remain kept, the cut member is retained in the section marked as cut, and the section itself is not rejected

#### Scenario: Cut reversed
- **WHEN** the owner restores a previously cut cast member
- **THEN** that member is kept again with its original content intact

#### Scenario: Cut members excluded from seeding
- **WHEN** a premise with cut cast members is approved
- **THEN** entities are created only for kept members

#### Scenario: Cut members excluded from regeneration constraints
- **WHEN** the cast section is accepted with some members cut and the premise is regenerated
- **THEN** only kept members are supplied to the model as settled constraints

#### Scenario: Every cast member cut
- **WHEN** the owner cuts every member of the cast and approves
- **THEN** the story is created with no entities and the approval succeeds

### Requirement: Regeneration preserves kept sections
Regeneration SHALL preserve every accepted and edited section exactly, and SHALL replace only rejected and pending sections. Kept sections MUST be supplied to the model as fixed constraints so regenerated sections stay coherent with them, and MUST be restored from stored content after the response is merged, regardless of what the model returns for them.

#### Scenario: Accepted section survives regeneration
- **WHEN** the owner accepts the cast, rejects the opening situation, and regenerates
- **THEN** the cast section's content is byte-identical afterward and the opening situation is replaced

#### Scenario: Edited section survives regeneration
- **WHEN** the owner edits the TLDR and regenerates
- **THEN** the owner's edited text is preserved exactly and its status remains `edited`

#### Scenario: Model rewrites a pinned section anyway
- **WHEN** the model returns different content for a section the owner had accepted
- **THEN** the stored accepted content wins and the returned content is discarded

#### Scenario: Kept sections steer the regeneration
- **WHEN** regeneration runs with accepted sections present
- **THEN** those sections are included in the prompt as settled constraints rather than omitted

#### Scenario: Notes steer the regeneration
- **WHEN** the owner has recorded notes and regenerates
- **THEN** the notes are included in the prompt as guidance for the sections being regenerated

#### Scenario: Every section accepted
- **WHEN** the owner has accepted every section and requests regeneration
- **THEN** the system makes no model call and reports that there is nothing to regenerate

#### Scenario: Regeneration fails
- **WHEN** a regeneration call fails or returns unparseable output after its retry
- **THEN** the premise the owner was reviewing is left intact and the failure is reported as retryable

### Requirement: Premise approval seeds a story
Approving a premise SHALL create a story owned by the approving user, record the resolved premise in the story world ledger, and create each kept cast member as an entity. Every entity created this way MUST be created through the standard entity-creation path so that its `entity_history` row is written and any pinned universe schema is enforced.

#### Scenario: Story created from an approved premise
- **WHEN** the owner approves a premise
- **THEN** a story is created with the premise title and the chosen content rating, the owner is recorded in `story_members`, and the story opens at turn 0

#### Scenario: World ledger seeded
- **WHEN** a story is created from an approved premise
- **THEN** the resolved premise — accepted content, and edited content wherever the owner edited — is written to the story world ledger

#### Scenario: Cast seeded as entities
- **WHEN** the approved premise contains kept cast members
- **THEN** each kept member is created as an entity on the new story, each entity creation writes an `entity_history` row, and cut members create nothing

#### Scenario: Rejected sections excluded
- **WHEN** the owner approves a premise with a rejected section
- **THEN** that section's content is absent from the world ledger, and a rejected cast section seeds no entities

#### Scenario: Entity creation partially fails
- **WHEN** one cast member fails to be created after the story already exists
- **THEN** the story and the successfully created entities are kept, the failure names which cast members were not created, and the story is not rolled back

#### Scenario: Universe pin carried through
- **WHEN** the intent named a universe and the premise is approved
- **THEN** the created story pins that universe's latest published version, exactly as a directly created story would

#### Scenario: Draft marked approved
- **WHEN** approval succeeds
- **THEN** the draft's status becomes `approved` and it records the story it produced

#### Scenario: Non-owner attempts approval
- **WHEN** a user who does not own the draft attempts to approve it
- **THEN** the request fails with the same not-found response a nonexistent draft returns, and no story is created

### Requirement: Premise draft ownership and isolation
A premise draft SHALL be owned by exactly one user and MUST NOT be readable or writable by anyone else. Row-level security MUST be enabled on the draft table in the migration that creates it, gated on the owning user rather than on story membership, since no story exists while a draft is under review.

#### Scenario: Owner reads their draft
- **WHEN** the owning user opens their draft
- **THEN** the draft and its premise are returned

#### Scenario: Another user attempts to read a draft
- **WHEN** a user requests a draft they do not own
- **THEN** the response is indistinguishable from a nonexistent draft

#### Scenario: Owning account deleted
- **WHEN** the owning account is deleted
- **THEN** the draft is preserved with a null owner rather than blocking the account deletion

### Requirement: Premise generation is optional
The system SHALL let a user create a story without generating a premise. A story created this way MUST be identical in every respect to a story created before premise generation existed.

#### Scenario: User skips premise generation
- **WHEN** a user chooses to start blank and supplies a title and content rating
- **THEN** the story is created immediately, no premise draft is created, and no model call is made

#### Scenario: User abandons a draft
- **WHEN** a user generates a premise and leaves without approving it
- **THEN** no story is created and the abandoned draft has no effect on the user's other stories

### Requirement: Premise generation is rate limited
Premise generation SHALL be rate limited per user under its own limit, distinct from the story-creation limit, because it triggers a billed model call reachable before any story exists.

#### Scenario: Within the limit
- **WHEN** a user generates or regenerates within their allowance
- **THEN** the call proceeds normally

#### Scenario: Limit exceeded
- **WHEN** a user exceeds the premise generation allowance
- **THEN** the request is rejected with a rate-limit message, no model call is made, and the existing draft is unchanged
