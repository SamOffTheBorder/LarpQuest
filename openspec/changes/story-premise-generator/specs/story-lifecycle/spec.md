## MODIFIED Requirements

### Requirement: Story creation
An authenticated user SHALL be able to create a story by supplying a title and a content rating, and MAY optionally pin it to a published universe version. The system MUST record the creator as the owner in `story_members` in the same transaction that inserts the story. A user MAY reach story creation either directly or by approving a generated premise; when created from a premise, the system SHALL additionally seed the story world ledger with the approved premise and create its kept cast as entities.

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

#### Scenario: Story created from an approved premise
- **WHEN** a user approves a generated premise
- **THEN** the system creates the story through the same owner-recording path as a direct creation, writes the approved premise to the story world ledger, and creates each kept cast member as an entity with its `entity_history` row

#### Scenario: Story created without a premise
- **WHEN** a user chooses to start blank rather than generating a premise
- **THEN** the story is created exactly as a directly created story, with an empty world ledger and no entities
