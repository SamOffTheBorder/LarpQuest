# entity-schema Specification

## Purpose

Per-universe-version `entity_schema` describing entity types and their fields, drawn from the engine's bounded primitive type vocabulary; validation of entity `data` against a pinned schema; dynamic form rendering driven by schema field types rather than universe-specific code.

## Requirements

### Requirement: Entity Schema definition
A universe version SHALL define an `entity_schema` describing one or more entity types, each with a label and a list of fields. Each field SHALL declare a `key` and a `type` drawn exclusively from the engine's primitive vocabulary (`string`, `text`, `enum`, `number`, `resource`, `capability_list`, `relationship_map`, `knowledge_set`, `standing_map`, `tag_list`, `reference`). The system MUST reject a schema containing any other type.

#### Scenario: Schema with only known primitives is accepted
- **WHEN** a universe version is saved with an `entity_schema` whose every field uses a type from the primitive vocabulary
- **THEN** the schema is persisted as part of that version

#### Scenario: Schema with an unknown field type is rejected
- **WHEN** a universe version is saved with a field whose `type` is not one of the engine's primitives
- **THEN** the system rejects the write with a validation error naming the offending field, and persists nothing

#### Scenario: Schema is data, not code
- **WHEN** two different universe versions define entirely different entity types and fields
- **THEN** both are stored and served by the same schema storage and retrieval code, with no code path that names either universe

### Requirement: Entity data validated against pinned schema
When a story has a pinned universe version, writes to an entity's `data` SHALL be validated against that version's `entity_schema` for the entity's `type`, using a validator built by dispatching on each field's declared type. A story with no pinned universe version MUST continue to accept unconstrained `data`, unchanged from Phase 1 behavior.

#### Scenario: Valid data accepted
- **WHEN** an entity of a schema-defined type is created or updated with `data` whose fields match their declared types
- **THEN** the write succeeds and the entity is persisted

#### Scenario: Invalid field value rejected
- **WHEN** an entity's `data` sets a field to a value that does not match its schema type (e.g. a string where the schema declares `number`, or an enum value outside the declared set)
- **THEN** the system rejects the write with a validation error identifying the field, and the entity is not modified

#### Scenario: Unpinned story keeps schemaless behavior
- **WHEN** a story has no pinned `universe_id`
- **THEN** entity `data` writes are accepted without schema validation, exactly as in Phase 1

#### Scenario: Validator dispatches on field type, not on universe
- **WHEN** two structurally different universes (one using `capability_list` and `resource` fields, one using only `knowledge_set` and `relationship_map` fields) each validate entity writes
- **THEN** both are validated by the same validator-building function, which branches only on the bounded set of primitive field types and never on a universe identifier, genre, or media type

### Requirement: Dynamic entity form rendering
The system SHALL render an entity edit form for a given entity type by walking its schema's field list and rendering one input component per field, selected by the field's declared type. No form component MUST reference a specific universe, genre, or media type.

#### Scenario: Form renders from schema alone
- **WHEN** a user opens the edit form for an entity whose type has a defined schema
- **THEN** the form displays one input per schema field, using the input appropriate to that field's type (e.g. a select for `enum`, a gauge input for `resource`, a list editor for `capability_list`)

#### Scenario: Two structurally different schemas render correctly with the same code
- **WHEN** the form renderer is given entity types from two structurally incompatible universes
- **THEN** both render correctly using the same renderer component tree, with no universe-specific branch
