## MODIFIED Requirements

### Requirement: Dynamic entity form rendering
The system SHALL render an entity edit form for a given entity type by walking its schema's field list and rendering one input component per field, selected by the field's declared type. No form component MUST reference a specific universe, genre, or media type. The form SHALL additionally accept a generated draft as initial values for its inputs, leaving every value editable before submission.

#### Scenario: Form renders from schema alone
- **WHEN** a user opens the edit form for an entity whose type has a defined schema
- **THEN** the form displays one input per schema field, using the input appropriate to that field's type (e.g. a select for `enum`, a gauge input for `resource`, a list editor for `capability_list`)

#### Scenario: Two structurally different schemas render correctly with the same code
- **WHEN** the form renderer is given entity types from two structurally incompatible universes
- **THEN** both render correctly using the same renderer component tree, with no universe-specific branch

#### Scenario: Generated draft populates the form
- **WHEN** a character draft is generated for an entity type
- **THEN** the draft's values appear in the matching inputs, every one of them remains editable, and nothing is persisted until the GM submits the form

#### Scenario: Dropped field renders blank
- **WHEN** a generated draft omits a field because its value failed schema validation
- **THEN** that field's input renders blank rather than showing an invalid value, and the form indicates the field was not filled
