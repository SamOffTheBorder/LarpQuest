## ADDED Requirements

### Requirement: Context assembly is a pure function
`assembleContext(story, turn)` SHALL be a pure function of its persisted inputs, returning the assembled prompt. Its output MUST NOT be stored as a database row, and calling it twice with unchanged inputs MUST produce identical output.

#### Scenario: Deterministic output
- **WHEN** `assembleContext` is called twice for the same story and turn with no intervening state change
- **THEN** both calls return byte-identical output

#### Scenario: No persistence side effect
- **WHEN** `assembleContext` runs
- **THEN** it performs no write to any table, so a failed generation leaves no context residue

### Requirement: Phase 1 context contents
The assembled context SHALL include the story's tone and style directives, every entity with status `active`, the world ledger, the last N chapters in full prose, the current turn's scene setup, and all submissions for the current turn.

#### Scenario: Active entities included
- **WHEN** context is assembled for a story with both active and inactive entities
- **THEN** all active entities appear with their full `data`, and inactive entities do not

#### Scenario: Recent chapters included
- **WHEN** context is assembled with the recent-chapter count set to 3
- **THEN** the three most recent published chapters appear in full prose in chronological order

#### Scenario: Fewer chapters exist than requested
- **WHEN** a story has fewer published chapters than the configured recent count
- **THEN** all existing chapters are included without error

#### Scenario: Retrieval is absent in this phase
- **WHEN** context is assembled in Phase 1
- **THEN** no vector retrieval, summary retrieval, or canon compression is performed, and the function signature is the one Phase 4 will extend without changing callers

### Requirement: Token budget enforcement
Assembly SHALL respect a configured token budget. When the assembled context would exceed it, the function MUST drop content in a defined priority order rather than truncating mid-structure or failing.

#### Scenario: Budget exceeded
- **WHEN** the assembled context would exceed the token budget
- **THEN** the oldest full-prose chapters are dropped first, and entity state, the world ledger, and the current turn's submissions are retained

#### Scenario: Budget cannot be met
- **WHEN** the required content alone exceeds the budget even after dropping all optional content
- **THEN** the function SHALL raise a clear error naming what could not fit, rather than silently sending an over-budget prompt

#### Scenario: Structures are never half-emitted
- **WHEN** content is dropped to fit the budget
- **THEN** whole chapters or whole entities are dropped, never a partial record
