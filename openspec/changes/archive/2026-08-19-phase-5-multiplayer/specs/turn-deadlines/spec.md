## ADDED Requirements

### Requirement: Deadline-triggered lock
An open turn whose `deadline` has passed SHALL be locked automatically according to the story's configured absent-player policy (`skip`, `ai_plays`, or `block`), without requiring a GM to act manually.

#### Scenario: Deadline passes under `skip` policy
- **WHEN** an open turn's deadline passes and the story's absent policy is `skip`
- **THEN** the turn is locked with whatever submissions already exist, and entities without a submission are simply absent from the Narrator's input

#### Scenario: Deadline passes under `ai_plays` policy
- **WHEN** an open turn's deadline passes and the story's absent policy is `ai_plays`
- **THEN** a placeholder submission is generated for each claimed entity that has not submitted, and the turn is then locked

#### Scenario: Deadline passes under `block` policy
- **WHEN** an open turn's deadline passes and the story's absent policy is `block`
- **THEN** the turn remains open and is not locked

#### Scenario: Deadline never set
- **WHEN** a turn has no `deadline` set
- **THEN** the deadline sweep takes no action on it

### Requirement: Deadline lock reuses manual lock validation
An automatic deadline-triggered lock SHALL be subject to the same validation as a manual lock, except for the role check that a manual lock requires.

#### Scenario: Deadline passes with zero submissions under `skip`
- **WHEN** an open turn's deadline passes with no submissions at all and the story's absent policy is `skip`
- **THEN** the turn remains open, since locking with zero submissions is invalid regardless of trigger

#### Scenario: Deadline passes with zero submissions under `ai_plays`
- **WHEN** an open turn's deadline passes with no submissions and the story's absent policy is `ai_plays`
- **THEN** placeholder submissions are generated for claimed entities first, so the turn locks with at least one submission
