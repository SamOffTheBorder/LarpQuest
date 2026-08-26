# turn-modes-extended Specification

## Purpose

The five turn modes beyond `freeform` — `action`, `scene`, `investigation`, `dialogue`, `montage` — registered in the existing turn-mode dispatch table, each with its own narrator prompt framing and extraction targets per build plan Part 9. Registering these requires no change to the turn loop itself.

## Requirements

### Requirement: Action mode
The dispatch table SHALL register an `action` turn mode. Its narrator prompt MUST treat a submission as an intended action to resolve into consequences, and its extraction targets MUST include capabilities, injuries, resources, and deaths. Narration for `action` mode continues to run through the streaming narration call, preserving live streaming for every action turn. When the turn is eligible (per the `fight-chapter-split` capability: at most one distinct submitting entity, and the turn is not itself a continuation), the prompt MUST instruct the narrator that it may end its prose with an exact, distinct marker line if and only if the submission resolves into a one-on-one fight against any single other established character — a player character, an NPC, or any other entity already established in the story, whether or not that character submitted anything this turn — and it is signaling a turning point rather than a full resolution. The engine MUST strip this marker from the prose before it is validated or persisted, and MUST ignore/strip it whenever the turn is not eligible, regardless of what the model emitted.

#### Scenario: Action turn runs
- **WHEN** a turn is generated in `action` mode
- **THEN** the dispatch table supplies a system prompt instructing the narrator to resolve each submitted intended action into a consequence, and extraction targets covering capabilities, injuries, resources, and deaths

#### Scenario: Action turn narration remains a streaming call
- **WHEN** the narrator responds to an `action` mode turn
- **THEN** the response is generated through the same streaming narration call used by every other mode, so live streaming is unaffected by the turning-point capability

#### Scenario: Turning-point marker offered for a single-submitter turn against any established character
- **WHEN** an `action` mode turn has at most one distinct submitting entity and the turn is not a continuation of an earlier chapter
- **THEN** the system prompt instructs the narrator that it may end its prose with the turning-point marker when the submission resolves into a one-on-one fight against any single established character — including one that submitted nothing this turn — and signals a turning point instead of a full resolution

#### Scenario: Turning-point marker withheld for ineligible turns
- **WHEN** an `action` mode turn's submissions come from two or more distinct entities, or the turn is itself a continuation
- **THEN** the system prompt does not mention the turning-point marker, and any occurrence of the marker text at the end of the resulting prose is stripped and ignored rather than treated as a turning-point signal

#### Scenario: Marker is never shown to readers or the validator
- **WHEN** the narrator's streamed prose ends with the turning-point marker
- **THEN** the marker is stripped from the prose before validation and before the chapter is persisted, so it never appears in the published chapter text

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
