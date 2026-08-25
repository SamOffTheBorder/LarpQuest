# room-safety Specification

## Purpose
TBD - created by archiving change phase-5-multiplayer. Update Purpose after archive.
## Requirements
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
A member SHALL be able to report a chapter or a submission with a reason. Reports MUST be visible to the story's owner and GMs. An owner or GM SHALL be able to mark a report resolved without deleting or altering the original report. An owner or GM SHALL be able to hide a reported chapter from other members; a hidden chapter's content SHALL remain visible to owners and GMs and SHALL remain unchanged in the database — only its visibility to non-manager members, exports, and share links is affected.

#### Scenario: Member reports a chapter
- **WHEN** a member submits a report against a published chapter with a reason
- **THEN** a `story_reports` row is created referencing the chapter, the reporter, and the reason, with status `open`

#### Scenario: Owner views reports
- **WHEN** the owner views the story's reports
- **THEN** all reports filed against that story are visible, including reporter, reason, and status

#### Scenario: Non-member cannot report
- **WHEN** a user who is not a member of the story attempts to file a report
- **THEN** the system SHALL reject the request

#### Scenario: Owner or GM resolves a report
- **WHEN** an owner or GM marks an `open` report resolved
- **THEN** the report's status becomes `resolved`, recording who resolved it and when, while its reason, reporter, and target remain unchanged

#### Scenario: Non-manager cannot resolve a report
- **WHEN** a player or spectator attempts to resolve a report
- **THEN** the system SHALL reject the request

#### Scenario: Owner or GM hides a reported chapter
- **WHEN** an owner or GM hides a chapter that was the target of a report
- **THEN** the chapter is excluded from what non-manager members see on the story page, in exports, and via share links, while owners and GMs continue to see it along with who hid it and when

#### Scenario: Hiding a chapter does not alter derived state
- **WHEN** a chapter is hidden
- **THEN** its `entity_history` rows, extracted diffs, and validation report are unchanged — hiding affects visibility only

#### Scenario: Owner or GM unhides a chapter
- **WHEN** an owner or GM unhides a previously hidden chapter
- **THEN** the chapter becomes visible to non-manager members again through the same surfaces it was hidden from

#### Scenario: Submissions are not removable
- **WHEN** a report targets a submission
- **THEN** the available action is resolving the report; no action in this requirement removes or alters the submission itself, consistent with submissions persisting independently of generation outcomes

### Requirement: Moderator resists submission-authored influence
The moderator's verdict is a control decision made about text the reporting party authored, so the moderator SHALL treat any attempt within a submission to influence its verdict as itself grounds
for a `flag` verdict rather than as a reason to `pass`. The moderator's `reason` string SHALL
describe the content, and SHALL NOT repeat instructions found inside it.

#### Scenario: Submission attempts to instruct the moderator
- **WHEN** a submission contains text directing the moderator to return `pass`, to ignore its instructions, or to treat the content as pre-approved
- **THEN** the moderator does not return `pass` on account of that text, and the attempt is itself a basis for `flag`

#### Scenario: Submission forges prompt scaffolding
- **WHEN** a submission contains text imitating the prompt's own section headings or fence delimiters
- **THEN** the forged scaffolding is contained within the submission's fence and does not alter how the moderator reads the surrounding prompt

#### Scenario: Reason string does not echo an injection
- **WHEN** the moderator flags a submission that contained an injection attempt
- **THEN** the recorded reason describes the attempt without reproducing its instructions verbatim

