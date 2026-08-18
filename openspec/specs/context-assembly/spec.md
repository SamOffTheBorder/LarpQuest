# context-assembly Specification

## Purpose

`assembleContext(story, turn)` — the pure function that builds the model's prompt from persisted state, in its no-retrieval Phase 1 form: active entities, the world ledger, the last N chapters in full prose, and the current turn's submissions, under a token budget.

## Requirements

### Requirement: Context assembly is a pure function
`assembleContext(story, turn)` SHALL be a pure function of its persisted inputs, returning the assembled prompt. Its output MUST NOT be stored as a database row, and calling it twice with unchanged inputs MUST produce identical output.

#### Scenario: Deterministic output
- **WHEN** `assembleContext` is called twice for the same story and turn with no intervening state change
- **THEN** both calls return byte-identical output

#### Scenario: No persistence side effect
- **WHEN** `assembleContext` runs
- **THEN** it performs no write to any table, so a failed generation leaves no context residue

### Requirement: Context assembly contents
The assembled context SHALL include the compressed canon bible (per the universe version's `context_policy.canon_compression`), the story's tone and style directives, every entity with status `active`, the world ledger, the last N chapters in full prose, the top-K retrieved chapter or arc summaries by vector similarity to the current turn's input, the current turn's scene setup, and all submissions for the current turn.

#### Scenario: Active entities included
- **WHEN** context is assembled for a story with both active and inactive entities
- **THEN** all active entities appear with their full `data`, and inactive entities do not

#### Scenario: Recent chapters included
- **WHEN** context is assembled with the recent-chapter count set to 3
- **THEN** the three most recent published chapters appear in full prose in chronological order

#### Scenario: Fewer chapters exist than requested
- **WHEN** a story has fewer published chapters than the configured recent count
- **THEN** all existing chapters are included without error

#### Scenario: Retrieved summaries included by similarity
- **WHEN** context is assembled for a turn with `retrieved_chapters` set to K
- **THEN** the K chapter (or, for older history, arc) summaries with highest cosine similarity to the current turn's input are included, excluding any chapter already present in the RECENT section

#### Scenario: Canon bible compression follows policy
- **WHEN** the universe version's `context_policy.canon_compression` is `summary` or `rules_only`
- **THEN** the corresponding pre-computed compressed representation is included instead of the full canon bible

#### Scenario: Story without a pinned universe version uses default policy
- **WHEN** context is assembled for a story with no pinned universe version
- **THEN** assembly falls back to the documented default context policy (no retrieval bias distinction, full tone-directive behavior) exactly as Phase 1 behaved, so ungoverned stories are unaffected by this change

### Requirement: Retrieval respects universe-supplied bias without branching on it
Retrieved-summary ranking SHALL use the same cosine-similarity mechanism for every universe; any behavioral difference driven by `retrieval_bias` SHALL be expressed through the content of the summaries being ranked, never through a conditional in the retrieval code path.

#### Scenario: No genre or universe conditional in retrieval code
- **WHEN** retrieval selects the top-K summaries for any two structurally different universes
- **THEN** the same ranking function runs unmodified for both, with no branch keyed on `retrieval_bias`, genre, or universe identity

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
</content>
