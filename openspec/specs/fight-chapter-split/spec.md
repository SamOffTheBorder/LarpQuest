# fight-chapter-split Specification

## Purpose

TBD - created by archiving change fight-chapter-split. Update Purpose after archive.

## Requirements

### Requirement: Turning-point signal for 1v1 action turns
When a turn in `action` mode has at most one distinct submitting entity, and the turn is not itself a continuation, the narrator SHALL be instructed that it may end its streamed prose with an exact turning-point marker line if and only if the submission resolves into a one-on-one fight against any single other established character — a player character, an NPC, or any other entity already established in the story, whether or not that character submitted anything this turn — and it is signaling a turning point rather than a full resolution. When a turn's submissions come from two or more distinct entities, or the turn is itself already a continuation (per `continues_chapter_id`), `action` mode's prompt MUST NOT mention the marker, and `generateTurn` MUST treat any occurrence of the marker in the resulting prose as absent — stripped without triggering a turning point — regardless of what the model emitted.

#### Scenario: Eligible single-submitter turn may signal a turning point against any established character
- **WHEN** a turn in `action` mode has at most one distinct submitting entity and the model judges the submission resolves into a one-on-one fight against any established character — including one that submitted nothing this turn — that has reached a dramatic turning point rather than a resolution
- **THEN** the narrator's streamed prose ends with the turning-point marker

#### Scenario: Two or more distinct submitting entities cannot signal a turning point
- **WHEN** a turn in `action` mode has submissions from two or more distinct entities
- **THEN** the prompt does not mention the turning-point marker, and `generateTurn` treats the turn as producing a complete chapter regardless of what appears in the model's raw output

#### Scenario: A continuation turn cannot split again
- **WHEN** a turn has `continues_chapter_id` set, indicating it is itself a continuation
- **THEN** the prompt does not mention the turning-point marker, and any occurrence of the marker in the resulting prose is stripped and ignored

### Requirement: Automatic continuation after a turning-point publish
When a chapter publishes whose prose carried the turning-point marker (stripped before persistence, per the Action mode requirement), the system SHALL automatically create, lock, and generate a second turn that resumes the same fight, without requiring a new submission from any player. This second turn's generation MUST always produce a complete resolution — it is never itself eligible to split.

#### Scenario: Chapter 1 publishes and chapter 2 is generated automatically
- **WHEN** a chapter publishes whose narration carried the turning-point marker
- **THEN** a new turn is created referencing the published chapter via `continues_chapter_id`, its submissions are copied forward from the original turn's submissions, and generation begins immediately without any player action

#### Scenario: Continuation chapter records the link back to chapter 1
- **WHEN** the continuation turn's chapter publishes
- **THEN** that chapter's `continues_chapter_id` references chapter 1's id

#### Scenario: Continuation resolves the fight
- **WHEN** the continuation turn generates its chapter
- **THEN** the resulting chapter is a complete resolution, not another turning point, per the "continuation turn cannot split again" requirement above

### Requirement: Chapter 1's publication is isolated from continuation failures
A failure in the automatic continuation turn — generation error, validation retry exhaustion, or any other error — SHALL NOT alter, unpublish, or delay chapter 1, which is already published before the continuation is created. The continuation turn on failure SHALL become `failed` and be retryable through the same mechanism as any other failed turn.

#### Scenario: Continuation generation fails
- **WHEN** the automatically-created continuation turn's generation fails
- **THEN** chapter 1 remains published unchanged, and the continuation turn's status becomes `failed`

#### Scenario: Continuation is retried like any other failed turn
- **WHEN** a continuation turn has failed
- **THEN** it can be retried through the existing failed-turn retry path, reusing its copied-forward submissions verbatim

### Requirement: Copied submissions do not re-trigger moderation
Submissions copied forward from the original turn to a continuation turn SHALL NOT be re-submitted through the player-facing submission-creation path and SHALL NOT be re-moderated, since their content already passed moderation when the original turn locked.

#### Scenario: Continuation turn skips moderation
- **WHEN** a continuation turn is created with copied-forward submissions
- **THEN** no new moderation check runs against those submissions before generation begins
