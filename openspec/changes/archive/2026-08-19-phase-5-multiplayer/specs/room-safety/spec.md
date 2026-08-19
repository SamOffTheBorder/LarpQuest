## ADDED Requirements

### Requirement: Content rating enforced in the Narrator prompt
A story's `content_rating` MUST be included in the Narrator system prompt as a binding constraint on generated content, resolved through a fixed lookup keyed by rating value.

#### Scenario: Everyone-rated story
- **WHEN** a turn is generated for a story with `content_rating: everyone`
- **THEN** the Narrator prompt includes the `everyone` content constraint instruction

#### Scenario: Mature-rated story
- **WHEN** a turn is generated for a story with `content_rating: mature`
- **THEN** the Narrator prompt includes the `mature` content constraint instruction, distinct from the `everyone` instruction

### Requirement: Submission-level moderation pass
Before a locked turn's submissions are used to generate a chapter, they SHALL be checked by the `moderator` model role. A `block` verdict MUST prevent generation and return the turn to `open`. A `flag` verdict MUST allow generation to proceed while recording the flag for GM review.

#### Scenario: Submission passes moderation
- **WHEN** a turn's submissions are checked and the moderator returns `pass`
- **THEN** generation proceeds normally

#### Scenario: Submission is blocked
- **WHEN** the moderator returns `block` for a turn's submissions
- **THEN** the turn returns to `open`, generation does not proceed, and the submitting user sees an error naming the reason

#### Scenario: Submission is flagged
- **WHEN** the moderator returns `flag` for a turn's submissions
- **THEN** generation proceeds, and the flag and reason are recorded and visible to the GM

#### Scenario: Moderator call fails
- **WHEN** the moderator role's model call errors or returns output that fails Zod parsing after one retry
- **THEN** the turn is treated as `flag` rather than blocked, the failure is recorded, and generation proceeds

### Requirement: Per-story reporting
A member SHALL be able to report a chapter or a submission with a reason. Reports MUST be visible to the story's owner and GMs.

#### Scenario: Member reports a chapter
- **WHEN** a member submits a report against a published chapter with a reason
- **THEN** a `story_reports` row is created referencing the chapter, the reporter, and the reason

#### Scenario: Owner views reports
- **WHEN** the owner views the story's reports
- **THEN** all reports filed against that story are visible, including reporter and reason

#### Scenario: Non-member cannot report
- **WHEN** a user who is not a member of the story attempts to file a report
- **THEN** the system SHALL reject the request
