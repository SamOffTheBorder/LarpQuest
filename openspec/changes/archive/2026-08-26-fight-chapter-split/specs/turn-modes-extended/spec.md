## MODIFIED Requirements

### Requirement: Action mode
The dispatch table SHALL register an `action` turn mode. Its narrator prompt MUST treat a submission as an intended action to resolve into consequences, and its extraction targets MUST include capabilities, injuries, resources, and deaths. Narration for `action` mode continues to run through the streaming narration call, preserving live streaming for every action turn. When the turn is eligible (per the `fight-chapter-split` capability: exactly two distinct entities acting adversarially, and the turn is not itself a continuation), the prompt MUST instruct the narrator to end its prose with an exact, distinct marker line if and only if it is signaling a turning point rather than a full resolution. The engine MUST strip this marker from the prose before it is validated or persisted, and MUST ignore/strip it whenever the turn is not eligible, regardless of what the model emitted.

#### Scenario: Action turn runs
- **WHEN** a turn is generated in `action` mode
- **THEN** the dispatch table supplies a system prompt instructing the narrator to resolve each submitted intended action into a consequence, and extraction targets covering capabilities, injuries, resources, and deaths

#### Scenario: Action turn narration remains a streaming call
- **WHEN** the narrator responds to an `action` mode turn
- **THEN** the response is generated through the same streaming narration call used by every other mode, so live streaming is unaffected by the turning-point capability

#### Scenario: Turning-point marker offered only for eligible 1v1 turns
- **WHEN** an `action` mode turn's submissions come from exactly two distinct entities and the turn is not a continuation of an earlier chapter
- **THEN** the system prompt instructs the narrator to end its prose with the turning-point marker when signaling a turning point instead of a full resolution

#### Scenario: Turning-point marker withheld for ineligible turns
- **WHEN** an `action` mode turn's submissions come from one entity, three or more distinct entities, or the turn is itself a continuation
- **THEN** the system prompt does not mention the turning-point marker, and any occurrence of the marker text at the end of the resulting prose is stripped and ignored rather than treated as a turning-point signal

#### Scenario: Marker is never shown to readers or the validator
- **WHEN** the narrator's streamed prose ends with the turning-point marker
- **THEN** the marker is stripped from the prose before validation and before the chapter is persisted, so it never appears in the published chapter text
