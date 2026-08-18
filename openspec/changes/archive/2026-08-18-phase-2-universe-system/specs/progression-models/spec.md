## ADDED Requirements

### Requirement: Progression model dispatch table
The engine SHALL resolve a universe version's progression semantics through a dispatch table keyed by a `progression_model` slug, mirroring the turn-mode dispatch pattern. Callers MUST resolve the model once and use what is returned; no caller MUST branch on the model's name.

#### Scenario: Registered model resolves
- **WHEN** the engine resolves a universe version whose `progression_model` is a registered slug
- **THEN** it receives the corresponding `ProgressionModel` implementation and calls its hooks without inspecting which slug it came from

#### Scenario: Unknown model rejected
- **WHEN** a universe version names a `progression_model` that is not registered
- **THEN** the system rejects the write (or, at resolution time, throws a typed error) rather than silently falling back to a default

#### Scenario: Adding a model is additive
- **WHEN** a new progression model is added to the dispatch table
- **THEN** no existing caller of `resolveProgressionModel` requires modification

### Requirement: `none` progression model
The system SHALL register a `none` progression model that applies no progression semantics: entity fields change only through direct edits or extraction, with no status-lifecycle enforcement.

#### Scenario: Universe with no progression concept
- **WHEN** a universe's `progression_model` is `none`
- **THEN** entities in that universe may be created and edited freely within their schema's type constraints, with no additional transition rules applied

### Requirement: `ability_unlock` progression model
The system SHALL register an `ability_unlock` progression model that governs `capability_list` fields, enforcing the status lifecycle `proposed → developing → available → mastered | lost | sealed` as the only allowed transitions.

#### Scenario: Valid status transition
- **WHEN** a capability in a `capability_list` field moves from `developing` to `available`
- **THEN** the transition is accepted and recorded via the standard entity_history mechanism

#### Scenario: Invalid status transition rejected
- **WHEN** a capability attempts to move from `proposed` directly to `mastered`, skipping the intermediate states
- **THEN** the system rejects the transition with a validation error and the capability's status is unchanged

#### Scenario: Terminal states
- **WHEN** a capability is in `mastered`, `lost`, or `sealed`
- **THEN** no further transition is accepted for that capability under the `ability_unlock` model

#### Scenario: Model applies only to capability_list fields
- **WHEN** an `ability_unlock` universe also has non-`capability_list` fields (e.g. a `resource` field for stamina)
- **THEN** the lifecycle enforcement applies only to the `capability_list` fields, and other fields are validated solely by their own primitive type rules

### Requirement: Structural proof of genre-agnostic dispatch
The engine's turn loop, entity write path, and context assembly MUST run both a universe using `ability_unlock` and a universe using `none` without any conditional branching on which universe, genre, or media type is active.

#### Scenario: Two structurally incompatible universes run on identical code
- **WHEN** a power-scaling universe (using `ability_unlock`, `capability_list`, and `resource` fields) and a non-combat social universe (using `none`, `knowledge_set`, and `relationship_map` fields) each run a full turn (submit → assemble → generate → publish → extract)
- **THEN** both complete successfully using the same turn loop, entity write path, and context assembly code, with no code path in the engine that names either universe, checks a genre tag, or special-cases a media type
