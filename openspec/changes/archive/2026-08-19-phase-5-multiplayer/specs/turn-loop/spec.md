## MODIFIED Requirements

### Requirement: Turn state machine
A turn SHALL occupy exactly one of the states `open`, `locked`, `generating`, `published`, or `failed`. Transitions MUST follow: `open` → `locked` → `generating` → `published`, with `generating` → `failed` on error and `failed` → `generating` on retry. Opening a turn MUST be requested by a user holding role `owner` or `gm`.

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
