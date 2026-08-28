## ADDED Requirements

### Requirement: Schema-driven character generation
The system SHALL offer, on the character creation surface, a generation action that drafts a character from freeform GM intent. When the story has a pinned universe version, the request SHALL be constructed by walking the target entity type's schema field list and describing each field by its declared primitive type and constraints. The prompt builder MUST NOT reference, enumerate, or branch on any genre, universe, or media type; the field list is its only source of structure.

#### Scenario: Draft fills schema-defined fields
- **WHEN** a GM enters a freeform description and requests generation for an entity type whose schema defines typed fields
- **THEN** the model is asked for a value for each of those fields, and the returned values populate the corresponding inputs on the creation form without saving anything

#### Scenario: Two structurally different universes generate through the same code
- **WHEN** generation runs for entity types drawn from two structurally incompatible universes
- **THEN** both produce a draft through the same prompt builder and the same call path, with no universe-specific branch

#### Scenario: Field constraints are carried into the prompt
- **WHEN** the field list contains an `enum` with permitted values, a `number` with a min and max, and a `resource` with a max
- **THEN** the prompt states the permitted values, the numeric bounds, and the resource maximum, so the model is constrained by the schema rather than guessing

#### Scenario: Story with no pinned universe
- **WHEN** generation runs for a story that has no pinned universe version
- **THEN** the same call path returns a name, a description, and a suggested type, the freeform notes are still carried into `data`, and no schema validation is attempted

#### Scenario: Generation is optional
- **WHEN** a GM ignores the generation control and fills the creation form by hand
- **THEN** the character is created exactly as before this capability existed, and the resulting entity is indistinguishable from a generated one

### Requirement: Generated values validated before display
Generated character data SHALL be validated against the pinned universe version's entity schema before it reaches the form, using the same validator applied on write. A field whose generated value fails validation MUST be dropped and its input left blank, and the system SHALL report which fields were dropped. Invalid generated values MUST NOT be persisted and MUST NOT be presented to the GM as usable values.

#### Scenario: Invalid field dropped, siblings kept
- **WHEN** a generated draft contains a `number` outside its declared range and an `enum` value not in its permitted list, alongside valid values for other fields
- **THEN** the two invalid fields are dropped and their inputs left blank, the valid sibling fields populate normally, and the GM is told which fields could not be filled

#### Scenario: Malformed output surfaces as retryable
- **WHEN** the model returns output that cannot be parsed into the required shape even after the gateway's single retry
- **THEN** a typed error is raised, the form retains the GM's typed intent, notes, and any pinned values, and the GM is offered a retry

#### Scenario: Generated data passes the same validator as a manual write
- **WHEN** a generated draft is submitted unchanged
- **THEN** it is validated on write by the same entity-schema validator that governs a hand-typed submission, with no relaxation for generated values

### Requirement: Freeform intent reaches the model
The character creation surface SHALL provide a freeform notes input, always present and independent of any schema field, for intent the universe's schema cannot express. Notes and the GM's description SHALL be included as input to every generation and regeneration request, fenced as untrusted content. Notes SHALL be stored with the created character.

#### Scenario: Notes steer the typed fields
- **WHEN** a GM writes freeform notes describing a trait no schema field covers and regenerates
- **THEN** the notes are included in the request and the regenerated typed fields reflect that intent

#### Scenario: Notes are fenced as untrusted
- **WHEN** GM-supplied description or notes text is placed into a prompt
- **THEN** it is wrapped through the untrusted-content fencing used by every other prompt builder, and instructions embedded in it are not followed as directives

#### Scenario: Notes persist on the character
- **WHEN** a character with freeform notes is saved
- **THEN** the notes are stored in the entity's `data` under a reserved key, alongside any schema-defined fields

### Requirement: Regeneration preserves GM-edited fields
When a GM edits a generated value by hand and then regenerates, the system SHALL treat that field as pinned: its value is passed into the request as a fixed constraint and returned unchanged. Only fields the GM has not edited SHALL be re-rolled.

#### Scenario: Edited field survives a re-roll
- **WHEN** a GM edits the generated name and one typed field, then regenerates
- **THEN** the edited name and field are unchanged in the new draft, and the untouched fields are re-rolled

#### Scenario: Pinned values are stated as constraints
- **WHEN** a regeneration request carries pinned fields
- **THEN** the prompt presents those fields as fixed values the response must preserve, so the re-rolled fields are drafted to be consistent with them

### Requirement: Generation is a role-declared, accounted model call
Character generation SHALL declare the `character` role, resolve its model from the story's `model_config`, parse its output through a Zod schema, and write a `usage_log` row for every call including calls that fail after tokens were billed. The action SHALL enforce story membership and a dedicated rate limit.

#### Scenario: Call declares its role
- **WHEN** a character is generated
- **THEN** the call requests the `character` role and the gateway resolves that role's model from the story's `model_config`, falling back to the documented default when unset

#### Scenario: Cost is recorded against the story
- **WHEN** a generation call completes or fails after tokens were billed
- **THEN** a `usage_log` row is written for the story, so the call appears in the per-story cost view

#### Scenario: Non-member cannot generate
- **WHEN** a user who is not a member of the story invokes the generation action
- **THEN** the action is rejected before any model call is made

#### Scenario: Repeated generation is rate limited
- **WHEN** a user exceeds the generation rate limit
- **THEN** further generation requests are rejected with a retry-after message and no model call is made
