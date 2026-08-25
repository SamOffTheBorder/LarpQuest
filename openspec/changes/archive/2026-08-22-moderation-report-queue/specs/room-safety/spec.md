## MODIFIED Requirements

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
