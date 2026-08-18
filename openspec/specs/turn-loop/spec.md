# turn-loop Specification

## Purpose

The turn open/lock/generate/publish/extract state machine; submission capture that persists independently of generation outcomes; publication that is never blocked by extraction; and the `freeform` turn mode resolved through a dispatch table.

## Requirements

### Requirement: Turn state machine
A turn SHALL occupy exactly one of the states `open`, `locked`, `generating`, `published`, or `failed`. Transitions MUST follow: `open` → `locked` → `generating` → `published`, with `generating` → `failed` on error and `failed` → `generating` on retry.

#### Scenario: Turn opens
- **WHEN** a story with no open turn has a turn opened
- **THEN** a `turns` row is created with status `open` and turn number one greater than the story's `current_turn`

#### Scenario: Second concurrent turn prevented
- **WHEN** an attempt is made to open a turn while another turn in the same story is not yet `published`
- **THEN** the system SHALL reject the request, so a story never has two live turns

#### Scenario: Invalid transition rejected
- **WHEN** code attempts a transition outside the permitted set, such as `published` → `generating`
- **THEN** the transition is rejected and the turn's state is unchanged

### Requirement: Submissions persist independently of generation
Submissions SHALL be written to durable storage when submitted, before any generation is attempted. No generation outcome — success, failure, timeout, or retry exhaustion — may delete or alter a submission.

#### Scenario: Generation fails after submission
- **WHEN** generation for a turn fails at any point
- **THEN** every submission for that turn remains intact and the turn becomes retryable without the user re-entering anything

#### Scenario: Turn is retried
- **WHEN** a `failed` turn is retried
- **THEN** the original submissions are reused verbatim, and a new generation attempt begins

#### Scenario: Submission edited before lock
- **WHEN** a user edits their submission while the turn is still `open`
- **THEN** the submission row is updated and the prior text is not required to be retained

### Requirement: Turn lock
Locking a turn SHALL freeze its submissions. Once locked, submissions MUST NOT be created or edited for that turn.

#### Scenario: Lock on user command
- **WHEN** the user locks an open turn that has at least one submission
- **THEN** the turn's status becomes `locked` and generation is dispatched

#### Scenario: Submission attempted after lock
- **WHEN** a submission is created or edited for a turn that is not `open`
- **THEN** the system rejects it with an error naming the turn's current state

#### Scenario: Lock with no submissions
- **WHEN** a user locks a turn that has no submissions
- **THEN** the system SHALL reject the lock, since there is no player intent for the narrator to address

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
Phase 1 SHALL implement exactly one turn mode, `freeform`. The mode MUST be resolved through a dispatch table keyed by mode name, not through a conditional on genre, universe, or media type.

#### Scenario: Freeform turn runs
- **WHEN** a turn is generated in `freeform` mode
- **THEN** the dispatch table supplies the prompt template and extraction targets for `freeform`, and the chapter records its `turn_mode`

#### Scenario: Adding a later mode
- **WHEN** a future phase registers an additional mode in the dispatch table
- **THEN** no change to the turn loop itself is required
</content>
