# entity-claiming Specification

## Purpose
TBD - created by archiving change phase-5-multiplayer. Update Purpose after archive.
## Requirements
### Requirement: Entity claiming
A player SHALL be able to claim an unclaimed entity in a story they are a member of, setting `controlled_by` to their user id. An entity that is already controlled by another user MUST NOT be claimed by a second user without first being released.

#### Scenario: Player claims an unclaimed entity
- **WHEN** a player claims an entity whose `controlled_by` is null
- **THEN** the entity's `controlled_by` is set to that player's user id

#### Scenario: Claiming an already-controlled entity is rejected
- **WHEN** a player attempts to claim an entity already controlled by a different user
- **THEN** the system SHALL reject the request

#### Scenario: GM reassigns a controlled entity
- **WHEN** a GM sets `controlled_by` on an entity that is already controlled by another user
- **THEN** the reassignment succeeds, since a GM may override entity control

### Requirement: Submission requires entity control
Creating or editing a submission for a claimed entity SHALL require the acting user to be that entity's controller, unless the acting user holds role `owner` or `gm`.

#### Scenario: Controller submits for their entity
- **WHEN** the user who controls an entity submits an action for it
- **THEN** the submission is accepted

#### Scenario: Non-controller submission rejected
- **WHEN** a user who does not control an entity, and who is not owner or GM, attempts to submit an action for it
- **THEN** the system SHALL reject the request

#### Scenario: GM submits for an unclaimed entity
- **WHEN** a GM submits an action for an entity with no controller
- **THEN** the submission is accepted, standing in for an absent or GM-controlled character

### Requirement: Entity release on member departure
When a member who controls one or more entities is removed from a story, or leaves voluntarily, those entities SHALL become unclaimed.

#### Scenario: Departing player's entity becomes unclaimed
- **WHEN** a player who controls an entity is removed from the story
- **THEN** that entity's `controlled_by` is set to null, leaving it available for the GM to reassign or narrate out

#### Scenario: Other members' claims are unaffected
- **WHEN** one member departs a story with multiple claimed entities
- **THEN** entities controlled by other, still-present members keep their `controlled_by` unchanged

