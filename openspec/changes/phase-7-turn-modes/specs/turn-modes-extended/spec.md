## ADDED Requirements

### Requirement: Action mode
The dispatch table SHALL register an `action` turn mode. Its narrator prompt MUST treat a submission as an intended action to resolve into consequences, and its extraction targets MUST include capabilities, injuries, resources, and deaths.

#### Scenario: Action turn runs
- **WHEN** a turn is generated in `action` mode
- **THEN** the dispatch table supplies a system prompt instructing the narrator to resolve each submitted intended action into a consequence, and extraction targets covering capabilities, injuries, resources, and deaths

### Requirement: Scene mode
The dispatch table SHALL register a `scene` turn mode. Its narrator prompt MUST treat a submission as an intent or emotional goal and produce an unresolved scene, and its extraction targets MUST include relationships, emotional state, and revelations.

#### Scenario: Scene turn runs
- **WHEN** a turn is generated in `scene` mode
- **THEN** the dispatch table supplies a system prompt instructing the narrator to write a scene toward the submitted emotional goal without forcing resolution, and extraction targets covering relationships, emotional state, and revelations

### Requirement: Investigation mode
The dispatch table SHALL register an `investigation` turn mode. Its narrator prompt MUST treat a submission as a line of inquiry and gate revealed information by the acting entity's tracked knowledge state, without referencing any genre-specific vocabulary. Its extraction targets MUST include knowledge state, evidence, and suspicion.

#### Scenario: Investigation turn runs
- **WHEN** a turn is generated in `investigation` mode
- **THEN** the dispatch table supplies a system prompt instructing the narrator to pursue the submitted line of inquiry and reveal only information the entity's tracked knowledge state qualifies it for, and extraction targets covering knowledge state, evidence, and suspicion

#### Scenario: Universe without a knowledge-state field
- **WHEN** a story runs `investigation` mode against a universe whose entity schema defines no knowledge-state field
- **THEN** generation proceeds without error and the gating instruction has no effect, rather than the engine raising a schema error

### Requirement: Dialogue mode
The dispatch table SHALL register a `dialogue` turn mode. Its narrator prompt MUST treat a submission as what an entity says or attempts in conversation and produce a conversation turn, and its extraction targets MUST include what was revealed and standing shifts.

#### Scenario: Dialogue turn runs
- **WHEN** a turn is generated in `dialogue` mode
- **THEN** the dispatch table supplies a system prompt instructing the narrator to write a conversation turn responding to each submission, and extraction targets covering revealed information and standing shifts

### Requirement: Montage mode
The dispatch table SHALL register a `montage` turn mode. Its narrator prompt MUST treat a submission as a focus area and produce a time-skip development summary, and its extraction targets MUST include progression across the skipped span.

#### Scenario: Montage turn runs
- **WHEN** a turn is generated in `montage` mode
- **THEN** the dispatch table supplies a system prompt instructing the narrator to write a time-skip summary developing the submitted focus areas, and extraction targets covering progression across the span

### Requirement: New modes require no turn-loop change
Each new mode SHALL be added only as an entry in the existing dispatch table. Registering a new mode MUST NOT require any change to the turn loop's mode-resolution call site or to any conditional keyed on mode identity, since none may exist.

#### Scenario: All six modes coexist
- **WHEN** `freeform`, `action`, `scene`, `investigation`, `dialogue`, and `montage` are all registered
- **THEN** `resolveTurnMode` returns the correct mode for each name from the same lookup used since Phase 1, with no branch added to the turn loop
