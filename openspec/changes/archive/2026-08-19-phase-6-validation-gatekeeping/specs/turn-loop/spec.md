## MODIFIED Requirements

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
