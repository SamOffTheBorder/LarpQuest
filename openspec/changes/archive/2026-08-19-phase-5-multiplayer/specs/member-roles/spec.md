## ADDED Requirements

### Requirement: Role-gated turn actions
Opening a turn and manually locking a turn SHALL require the acting user to hold role `owner` or `gm` in the story. A `player` or `spectator` MUST be rejected.

#### Scenario: GM opens a turn
- **WHEN** a user with role `gm` opens a turn
- **THEN** the turn is created as normal

#### Scenario: Player cannot open a turn
- **WHEN** a user with role `player` attempts to open a turn
- **THEN** the system SHALL reject the request with an error naming the required role

#### Scenario: Owner-run, GM-less story
- **WHEN** a story has no member with role `gm` and the owner opens or locks a turn
- **THEN** the action succeeds, since `owner` always satisfies the owner-or-gm check

### Requirement: Spectator read-only access
A user with role `spectator` SHALL be able to read a story's chapters, entities, and turn state, and MUST NOT be able to submit, claim an entity, open or lock a turn, or modify any story data.

#### Scenario: Spectator reads chapters
- **WHEN** a spectator requests a story's published chapters
- **THEN** the chapters are returned

#### Scenario: Spectator attempts a submission
- **WHEN** a spectator attempts to create a submission for an open turn
- **THEN** the system SHALL reject the request

### Requirement: Member removal
An owner or GM SHALL be able to remove another member from a story. A removed member's controlled entities MUST become unclaimed rather than left referencing a former member.

#### Scenario: GM removes a player
- **WHEN** a GM removes a player from the story
- **THEN** the `story_members` row for that user is deleted, and any entity with `controlled_by` equal to that user has `controlled_by` set to null

#### Scenario: Player cannot remove another member
- **WHEN** a user with role `player` attempts to remove another member
- **THEN** the system SHALL reject the request

#### Scenario: Owner cannot be removed
- **WHEN** any user attempts to remove the story's owner from `story_members`
- **THEN** the system SHALL reject the request
