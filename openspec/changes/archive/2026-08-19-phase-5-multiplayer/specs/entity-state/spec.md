## MODIFIED Requirements

### Requirement: Append-only entity history
Every change to an entity's `data` SHALL write an `entity_history` row recording the diff, the chapter it came from when applicable, and who applied it. History rows MUST NOT be updated or deleted. A manual edit to an entity MUST be performed by that entity's controller, or by a user holding role `owner` or `gm`; other members MUST be rejected.

#### Scenario: Diff applied from a published chapter
- **WHEN** an extracted diff is applied to an entity
- **THEN** the entity's `data` is updated and one `entity_history` row is written referencing the originating chapter

#### Scenario: Manual edit by the controller
- **WHEN** the user who controls an entity edits it directly through the UI
- **THEN** an `entity_history` row is written with the acting user and a null chapter reference

#### Scenario: Manual edit by a non-controller rejected
- **WHEN** a user who neither controls the entity nor holds role `owner` or `gm` attempts to edit it directly
- **THEN** the system SHALL reject the request

#### Scenario: GM edits any entity
- **WHEN** a user with role `gm` edits an entity regardless of its `controlled_by`
- **THEN** the edit succeeds and an `entity_history` row is written with the acting GM as the actor

#### Scenario: History write fails
- **WHEN** the `entity_history` insert fails
- **THEN** the entity update rolls back with it, so state and history can never diverge
