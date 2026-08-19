## MODIFIED Requirements

### Requirement: Freeform turn mode dispatch
Phase 1 SHALL implement exactly one turn mode, `freeform`. The mode MUST be resolved through a dispatch table keyed by mode name, not through a conditional on genre, universe, or media type. From Phase 7 onward, a turn's mode SHALL be resolved as the story's currently active mode (per the `mode-switching` capability) at the moment the turn is created, falling back to `freeform` when the story has no active mode set, rather than always defaulting to `freeform`.

#### Scenario: Freeform turn runs
- **WHEN** a turn is generated in `freeform` mode
- **THEN** the dispatch table supplies the prompt template and extraction targets for `freeform`, and the chapter records its `turn_mode`

#### Scenario: Adding a later mode
- **WHEN** a future phase registers an additional mode in the dispatch table
- **THEN** no change to the turn loop itself is required

#### Scenario: New turn adopts the story's active mode
- **WHEN** a turn is opened on a story whose active mode has been set to a non-`freeform` registered mode
- **THEN** the new turn's `mode` is set to that active mode, not to `freeform`

#### Scenario: Story with no active mode set defaults to freeform
- **WHEN** a turn is opened on a story that has never had its active mode set
- **THEN** the new turn's `mode` is `freeform`

#### Scenario: A turn's mode is immutable after creation
- **WHEN** a turn has already been created with a given mode
- **THEN** no later story-level mode switch changes that turn's own stored `mode` value
