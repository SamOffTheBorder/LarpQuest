# story-lifecycle Specification

## Purpose

Creating, listing, opening, and archiving a story; owner membership recorded in `story_members`; per-story model and turn configuration seeded with defaults; optional pinning to a published universe version that persists independently of the universe's later evolution.

## Requirements

### Requirement: Story creation
An authenticated user SHALL be able to create a story by supplying a title and a content rating, and MAY optionally pin it to a published universe version. The system MUST record the creator as the owner in `story_members` in the same transaction that inserts the story.

#### Scenario: Story is created successfully
- **WHEN** an authenticated user submits a valid title and content rating
- **THEN** the system inserts a `stories` row with `current_turn` 0 and status `active`, inserts a `story_members` row with role `owner`, and redirects to the story

#### Scenario: Story created with a universe
- **WHEN** an authenticated user submits a valid title, content rating, and an existing published universe
- **THEN** the system inserts the `stories` row with `universe_id` and `universe_version` set to that universe's latest published version at creation time

#### Scenario: Membership insert fails
- **WHEN** the `story_members` insert fails after the `stories` insert
- **THEN** the whole operation rolls back, leaving no orphaned story that its creator cannot access

#### Scenario: Invalid title
- **WHEN** a user submits an empty title or one over the length limit
- **THEN** the system rejects the request with a validation error and creates nothing

### Requirement: Per-story model and turn configuration
Each story SHALL carry a `model_config` mapping each model role to a model string, and a `turn_config`. Both MUST be seeded with defaults at creation so a story is runnable without the user configuring anything.

#### Scenario: Defaults applied at creation
- **WHEN** a story is created without explicit model configuration
- **THEN** `model_config` is populated with the default model string for every role in the role table, and the story can run a turn immediately

#### Scenario: Owner overrides a role's model
- **WHEN** the owner sets a different model string for the `narrator` role
- **THEN** subsequent narration calls for that story use the new model, and calls for other roles are unaffected

#### Scenario: Unknown role rejected
- **WHEN** a configuration update names a role outside the defined role table
- **THEN** the system rejects the update with a validation error

### Requirement: Story listing and access
A user SHALL see exactly those stories for which they hold a `story_members` row.

#### Scenario: Owner lists their stories
- **WHEN** an authenticated user opens the story list
- **THEN** the system returns their stories ordered by most recently active, and no story belonging solely to another user

#### Scenario: Direct navigation to a foreign story
- **WHEN** a user navigates directly to the URL of a story they do not belong to
- **THEN** the system responds as it would for a nonexistent story, without disclosing that the story exists

### Requirement: Story archival
The owner SHALL be able to archive a story. Archiving MUST be reversible and MUST NOT delete chapters, entities, or history.

#### Scenario: Owner archives a story
- **WHEN** the owner archives an active story
- **THEN** the story's status becomes `archived`, it no longer accepts new turns, and its chapters remain readable

#### Scenario: Owner restores an archived story
- **WHEN** the owner restores an archived story
- **THEN** the story returns to `active` and accepts new turns, with its turn numbering continuing from where it stopped

### Requirement: Universe version pin persists independently of the universe
A story's `universe_id` and `universe_version` SHALL persist unchanged as the universe evolves, and change only through an explicit owner-initiated upgrade.

#### Scenario: Universe publishes a new version
- **WHEN** a story is pinned to universe version 1 and its universe publishes version 2
- **THEN** the story's `universe_version` remains 1 until its owner explicitly upgrades it
