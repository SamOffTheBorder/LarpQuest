## ADDED Requirements

### Requirement: Universe as a versioned, independent record
A universe SHALL exist independently of any story, owned by the user who created it, and SHALL have one or more immutable `universe_versions`, each bundling an `entity_schema` and a `progression_model` (with its config) as a single versioned unit.

#### Scenario: Universe created with an initial version
- **WHEN** an owner creates a universe with an entity schema and a progression model
- **THEN** the system creates a `universes` row and a `universe_versions` row at version 1, published immediately

#### Scenario: Universe has no stories yet
- **WHEN** a universe is created but not yet pinned by any story
- **THEN** its owner can still read and create new versions of it

### Requirement: Immutable versions
Once published, a `universe_versions` row's `entity_schema` and `progression_model`/`progression_config` MUST NOT be changed in place. Changing a universe's schema or progression configuration SHALL create a new version with an incremented version number.

#### Scenario: Owner edits a published universe
- **WHEN** the owner changes the entity schema of a universe that already has a published version
- **THEN** the system inserts a new `universe_versions` row with `version` incremented by one, and the prior version row remains unchanged in the database

#### Scenario: Attempt to mutate a published version directly
- **WHEN** any caller attempts to update the `entity_schema` or `progression_model` columns of an existing `universe_versions` row
- **THEN** the system rejects the write

### Requirement: Stories pin a universe version
A story MAY reference a universe at a specific, explicit version (`universe_id` + `universe_version`). Once set, the pin MUST NOT change except through an explicit owner-initiated upgrade action; new versions of the universe MUST NOT be silently applied to existing stories.

#### Scenario: Story created against a universe
- **WHEN** a story is created specifying a universe and it has at least one published version
- **THEN** the story's `universe_id` and `universe_version` are set to that universe's latest published version at creation time, and persist unchanged afterward

#### Scenario: Universe gains a new version after a story has pinned an earlier one
- **WHEN** the universe's owner publishes version 2 while a story is still pinned to version 1
- **THEN** the story continues to use version 1's schema and progression model for all reads and writes until its owner explicitly upgrades it

#### Scenario: Owner explicitly upgrades a story's pinned version
- **WHEN** the story's owner chooses to upgrade the story to a newer published universe version
- **THEN** the story's `universe_version` is updated, and subsequent entity validation and progression logic use the new version; prior entity_history rows are untouched

#### Scenario: Story created without a universe
- **WHEN** a story is created without specifying a universe
- **THEN** `universe_id` and `universe_version` remain null and the story behaves exactly as a Phase 1 story
