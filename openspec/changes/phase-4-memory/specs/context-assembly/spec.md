## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Retrieval respects universe-supplied bias without branching on it
Retrieved-summary ranking SHALL use the same cosine-similarity mechanism for every universe; any behavioral difference driven by `retrieval_bias` SHALL be expressed through the content of the summaries being ranked, never through a conditional in the retrieval code path.

#### Scenario: No genre or universe conditional in retrieval code
- **WHEN** retrieval selects the top-K summaries for any two structurally different universes
- **THEN** the same ranking function runs unmodified for both, with no branch keyed on `retrieval_bias`, genre, or universe identity
