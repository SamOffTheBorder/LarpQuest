## ADDED Requirements

### Requirement: Post-publish summary and embedding generation
On chapter publish, the system SHALL generate a structured summary (what happened, who was involved, what changed) using the `summarizer` role and an embedding of that summary using the `embedder` role, as a step that runs strictly after publication and can never affect it.

#### Scenario: Summary and embedding generated after publish
- **WHEN** a chapter is published
- **THEN** a memory job is enqueued for that chapter, and when processed it writes a structured summary to `chapters.summary` and a vector to `chapters.embedding`

#### Scenario: Embedding is computed from the summary, not the prose
- **WHEN** a chapter's memory job runs
- **THEN** the embedding call receives the generated summary text as input, never the raw chapter prose

#### Scenario: Memory generation never blocks or delays publication
- **WHEN** a chapter is published
- **THEN** the publish operation completes and the chapter is immediately readable regardless of whether its memory job has run, succeeded, or failed

#### Scenario: Failure isolation matches extraction
- **WHEN** the summarizer or embedder call fails after retries are exhausted
- **THEN** `chapters.memory_status` is set to `failed`, the failure is recorded on the queue row, the chapter's prose and publication state are untouched, and the job is retryable

#### Scenario: Every memory model call is billed and logged
- **WHEN** a summarizer or embedder call completes or fails
- **THEN** a `usage_log` row is written for that call, including calls that fail after tokens were billed

### Requirement: Arc-summary compaction beyond ~50 chapters
Once a story's chapter count crosses the arc-compaction threshold, the system SHALL generate one arc summary per closed 10–15-chapter arc, using the `summarizer` role, so that long-story context growth does not remain strictly linear in chapter count.

#### Scenario: Arc summary generated when a story crosses an arc boundary
- **WHEN** a story publishes the chapter that closes its Nth arc past the compaction threshold
- **THEN** an arc-summary job is enqueued covering that arc's chapter range, and on completion an `arc_summaries` row is written with `from_chapter`, `to_chapter`, `summary`, and `embedding`

#### Scenario: Arc compaction does not affect stories below the threshold
- **WHEN** a story has fewer chapters than the compaction threshold
- **THEN** no arc-summary jobs are enqueued and no `arc_summaries` rows exist for that story

#### Scenario: Arc compaction failure does not block chapter publication or chapter memory
- **WHEN** an arc-summary job fails
- **THEN** the triggering chapter's own summary/embedding and publication status are unaffected, and the arc-summary job is independently retryable

### Requirement: Memory queue ownership and RLS
Memory and arc-summary jobs SHALL be persisted as durable queue rows readable only by members of the owning story, gated through `story_members`, matching the existing extraction queue's access pattern.

#### Scenario: Non-member cannot read a story's memory queue
- **WHEN** a user who is not a member of a story attempts to read that story's `memory_queue` or `arc_summaries` rows
- **THEN** row-level security denies the read

#### Scenario: Stale claims are recovered
- **WHEN** a memory job has been claimed but not completed after the stale-claim threshold
- **THEN** it becomes claimable again by the next worker invocation, matching `extraction_queue`'s stale-claim recovery
