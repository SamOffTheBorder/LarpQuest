# entity-state Specification

## Purpose

Schemaless entity records (`type`, `name`, opaque `data` jsonb) plus the append-only `entity_history` ledger, diff application with conflict detection, and rollback via compensating history rows. When a story has a pinned universe version, `data` is validated against that version's entity schema (see `entity-schema`); otherwise it remains unconstrained as in Phase 1.
## Requirements
### Requirement: Schemaless entity records
An entity SHALL be stored as a type, a name, and an opaque `data` jsonb payload. When the owning story has no pinned universe version, the engine MUST NOT validate, constrain, or interpret the contents of `data`, and MUST NOT define fields specific to any genre, universe, or media type. When the owning story has a pinned universe version, `data` MUST be validated against that version's entity schema for the entity's type (see `entity-schema`), but the engine still MUST NOT branch on which universe, genre, or media type is active — only on the bounded set of schema field types.

#### Scenario: Entity created with arbitrary data (no pinned universe)
- **WHEN** a user creates an entity in a story with no pinned universe, whose `data` contains fields the engine has never seen
- **THEN** the entity is stored unchanged and is available to context assembly

#### Scenario: Engine reads an unknown field
- **WHEN** context assembly encounters a `data` field it has no knowledge of
- **THEN** it serializes the field as-is without special handling, and no code path branches on the field's name or the entity's universe

#### Scenario: Entity name is required
- **WHEN** an entity is created without a name
- **THEN** the system rejects the request with a validation error

#### Scenario: Entity data validated against a pinned schema
- **WHEN** a user creates or updates an entity in a story with a pinned universe version
- **THEN** `data` is validated against that version's entity schema for the entity's type before the write is persisted, per the `entity-schema` capability

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

### Requirement: Diff application
A diff SHALL name the entity, the field, the previous value, the new value, and the evidence supporting it. Application MUST be rejected when the recorded previous value does not match the entity's current value.

#### Scenario: Diff applies cleanly
- **WHEN** a diff's `from` value matches the entity's current value for that field
- **THEN** the field is set to the `to` value and history is recorded

#### Scenario: Stale diff detected
- **WHEN** a diff's `from` value does not match the entity's current value
- **THEN** the system SHALL reject the diff, record it as conflicted for review, and leave the entity unchanged

#### Scenario: Diff targets a nonexistent entity
- **WHEN** a diff names an entity id that does not exist in the story
- **THEN** the diff is rejected and recorded as conflicted, and no other diff in the batch is prevented from applying

### Requirement: Rollback via history
The system SHALL be able to reverse every diff applied by a given chapter, restoring entities to their state before that chapter was published.

#### Scenario: Chapter is unpublished
- **WHEN** a user unpublishes a chapter
- **THEN** every `entity_history` row originating from that chapter is reversed in reverse chronological order, and the reversal itself is recorded as new history rows rather than by deleting the originals

#### Scenario: Entity changed after the chapter being rolled back
- **WHEN** a later chapter or manual edit has since changed a field that the rollback would restore
- **THEN** the system SHALL surface the conflict for the user to resolve rather than silently overwriting the newer value

