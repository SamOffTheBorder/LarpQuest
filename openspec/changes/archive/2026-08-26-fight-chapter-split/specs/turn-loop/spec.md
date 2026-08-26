## ADDED Requirements

### Requirement: System-initiated continuation turns
The turn loop SHALL support a turn being created and driven to completion entirely by the system, without a user calling the turn-open action, when that turn is a fight continuation per the `fight-chapter-split` capability. A system-initiated continuation turn SHALL pass through the same `open → locked → generating → validating → published`/`failed` state machine as any user-initiated turn, and MUST NOT be created while another turn for the same story is not yet `published`, per the existing one-live-turn invariant.

#### Scenario: Continuation turn is created only after the prior turn is published
- **WHEN** the system creates a continuation turn following a turning-point chapter
- **THEN** the continuation turn is only inserted after the originating turn's status is `published`, so the one-live-turn invariant is never violated

#### Scenario: Continuation turn uses the same state machine
- **WHEN** a system-initiated continuation turn is generated
- **THEN** it moves through `generating` → `validating` → `published` (or `failed`) using the same transition rules as a user-initiated turn, with no new turn status introduced

#### Scenario: Continuation turn is not opened via the role-checked open action
- **WHEN** the system creates a continuation turn
- **THEN** it does so without requiring an acting user holding role `owner` or `gm`, since no user is initiating this specific turn
