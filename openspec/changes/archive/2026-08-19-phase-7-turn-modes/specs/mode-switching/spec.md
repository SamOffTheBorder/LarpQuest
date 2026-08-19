## ADDED Requirements

### Requirement: Mode switch authorization
Changing a story's active turn mode SHALL be permitted only for a user holding role `owner` or `gm` on that story, per the `member-roles` capability. The target mode MUST be a name registered in the turn mode dispatch table.

#### Scenario: Owner switches mode
- **WHEN** a user with role `owner` requests a mode switch to a registered mode name
- **THEN** the story's active mode is updated

#### Scenario: Player cannot switch mode
- **WHEN** a user with role `player` or `spectator` requests a mode switch
- **THEN** the system SHALL reject the request with an error naming the required role

#### Scenario: Unknown mode rejected
- **WHEN** an owner or GM requests a switch to a mode name not present in the dispatch table
- **THEN** the system SHALL reject the request rather than persisting an unresolvable mode

### Requirement: Mode switch audit trail
Every successful mode switch SHALL write an append-only row recording the previous mode, the new mode, the acting user, and the time of the change. This row MUST NOT be updated or deleted by any non-service-role caller.

#### Scenario: Switch is recorded
- **WHEN** a mode switch succeeds
- **THEN** a new row is written capturing the story, previous mode, new mode, and the acting user's identity

#### Scenario: History is append-only
- **WHEN** any user attempts to update or delete an existing mode-switch record
- **THEN** the system SHALL deny the operation for every caller other than the service role

### Requirement: Effective-from-next-turn semantics
A mode switch SHALL take effect starting with the next turn opened after the switch. Turns already `open`, `locked`, `generating`, `validating`, or `published` at the time of the switch MUST keep the mode they were created with.

#### Scenario: Switch during an open turn
- **WHEN** the active mode is switched while a turn is currently open
- **THEN** the currently open turn continues to resolve in the mode it was created with, and the new mode applies starting with the following turn

#### Scenario: Switch between turns
- **WHEN** the active mode is switched while no turn is currently open
- **THEN** the next turn opened uses the newly active mode

#### Scenario: No retroactive change
- **WHEN** a story's active mode has been switched one or more times over its history
- **THEN** every already-created turn's stored mode remains exactly what it was at that turn's creation
