## ADDED Requirements

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
