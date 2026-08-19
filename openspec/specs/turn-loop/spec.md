# turn-loop Specification

## Purpose

The turn open/lock/generate/publish/extract state machine; submission capture that persists independently of generation outcomes; publication that is never blocked by extraction; and the `freeform` turn mode resolved through a dispatch table.
## Requirements
### Requirement: Turn state machine
A turn SHALL occupy exactly one of the states `open`, `locked`, `generating`, `validating`, `published`, or `failed`. Transitions MUST follow: `open` → `locked` → `generating` → `validating` → `published`, with `generating` → `failed` on generation error, `validating` → `generating` on a block-severity validation retry (per the `validator-loop` capability, capped at 2 retries), `validating` → `failed` on retry exhaustion or a validator/gatekeeper call that fails after retry, and `failed` → `generating` on manual retry. Opening a turn MUST be requested by a user holding role `owner` or `gm`.

#### Scenario: Turn opens
- **WHEN** a user with role `owner` or `gm` opens a turn on a story with no open turn
- **THEN** a `turns` row is created with status `open` and turn number one greater than the story's `current_turn`

#### Scenario: Player cannot open a turn
- **WHEN** a user with role `player` or `spectator` attempts to open a turn
- **THEN** the system SHALL reject the request with an error naming the required role

#### Scenario: Second concurrent turn prevented
- **WHEN** an attempt is made to open a turn while another turn in the same story is not yet `published`
- **THEN** the system SHALL reject the request, so a story never has two live turns

#### Scenario: Invalid transition rejected
- **WHEN** code attempts a transition outside the permitted set, such as `published` → `generating`
- **THEN** the transition is rejected and the turn's state is unchanged

#### Scenario: Draft enters validation before publication
- **WHEN** generation completes and produces a chapter draft
- **THEN** the turn transitions to `validating` rather than directly to `published`

#### Scenario: Validated draft publishes
- **WHEN** validation of a draft completes with no `block`-severity flags
- **THEN** the turn transitions from `validating` to `published`

#### Scenario: Blocked draft returns to generation
- **WHEN** validation of a draft produces a `block`-severity flag and the retry cap has not been reached
- **THEN** the turn transitions from `validating` back to `generating` per the `validator-loop` capability

#### Scenario: Validation exhaustion fails the turn
- **WHEN** validation retries are exhausted, or a validator/gatekeeper call fails after its own retry
- **THEN** the turn transitions from `validating` to `failed`

### Requirement: Submissions persist independently of generation
Submissions SHALL be written to durable storage when submitted, before any generation is attempted. No generation outcome — success, failure, timeout, or retry exhaustion — may delete or alter a submission. Creating or editing a submission for a claimed entity additionally requires the acting user to control that entity, per the `entity-claiming` capability.

#### Scenario: Generation fails after submission
- **WHEN** generation for a turn fails at any point
- **THEN** every submission for that turn remains intact and the turn becomes retryable without the user re-entering anything

#### Scenario: Turn is retried
- **WHEN** a `failed` turn is retried
- **THEN** the original submissions are reused verbatim, and a new generation attempt begins

#### Scenario: Submission edited before lock
- **WHEN** the controlling user edits their submission while the turn is still `open`
- **THEN** the submission row is updated and the prior text is not required to be retained

#### Scenario: Non-controller cannot submit
- **WHEN** a user who does not control the targeted entity, and is not owner or GM, attempts to create a submission
- **THEN** the system SHALL reject the request

### Requirement: Turn lock
Locking a turn SHALL freeze its submissions. Once locked, submissions MUST NOT be created or edited for that turn. A manual lock MUST be requested by a user holding role `owner` or `gm`. A turn MAY also be locked automatically when its `deadline` passes, per the `turn-deadlines` capability, without a role check.

#### Scenario: Lock on user command
- **WHEN** a user with role `owner` or `gm` locks an open turn that has at least one submission
- **THEN** the turn's status becomes `locked` and generation is dispatched

#### Scenario: Player cannot manually lock
- **WHEN** a user with role `player` or `spectator` attempts to lock a turn
- **THEN** the system SHALL reject the request

#### Scenario: Submission attempted after lock
- **WHEN** a submission is created or edited for a turn that is not `open`
- **THEN** the system rejects it with an error naming the turn's current state

#### Scenario: Lock with no submissions
- **WHEN** a turn with no submissions is locked, manually or via deadline
- **THEN** the system SHALL reject the lock, since there is no player intent for the narrator to address

#### Scenario: Deadline-triggered lock bypasses the role check
- **WHEN** a turn's deadline passes and the deadline sweep locks it per the story's absent policy
- **THEN** the lock succeeds without any user holding `owner` or `gm` having acted, since the trigger is the deadline itself, not a user action

### Requirement: Publication precedes extraction
A chapter SHALL be published as soon as generation and persistence succeed. Extraction MUST run after publication and MUST NOT be able to block, delay, or reverse it.

#### Scenario: Extraction fails
- **WHEN** state extraction fails or returns unparseable output for a published chapter
- **THEN** the chapter remains published and readable, and extraction is queued for retry

#### Scenario: Extraction is slow
- **WHEN** extraction has not yet completed
- **THEN** the chapter is already visible to readers, marked as having state updates pending

#### Scenario: Successful extraction
- **WHEN** extraction succeeds
- **THEN** the resulting diffs are applied per the entity-state rules and the chapter's `extracted_diffs` is populated

### Requirement: Freeform turn mode dispatch
Phase 1 SHALL implement exactly one turn mode, `freeform`. The mode MUST be resolved through a dispatch table keyed by mode name, not through a conditional on genre, universe, or media type. From Phase 7 onward, a turn's mode SHALL be resolved as the story's currently active mode (per the `mode-switching` capability) at the moment the turn is created, falling back to `freeform` when the story has no active mode set, rather than always defaulting to `freeform`.

#### Scenario: Freeform turn runs
- **WHEN** a turn is generated in `freeform` mode
- **THEN** the dispatch table supplies the prompt template and extraction targets for `freeform`, and the chapter records its `turn_mode`

#### Scenario: Adding a later mode
- **WHEN** a future phase registers an additional mode in the dispatch table
- **THEN** no change to the turn loop itself is required

#### Scenario: New turn adopts the story's active mode
- **WHEN** a turn is opened on a story whose active mode has been set to a non-`freeform` registered mode
- **THEN** the new turn's `mode` is set to that active mode, not to `freeform`

#### Scenario: Story with no active mode set defaults to freeform
- **WHEN** a turn is opened on a story that has never had its active mode set
- **THEN** the new turn's `mode` is `freeform`

#### Scenario: A turn's mode is immutable after creation
- **WHEN** a turn has already been created with a given mode
- **THEN** no later story-level mode switch changes that turn's own stored `mode` value
</content>

