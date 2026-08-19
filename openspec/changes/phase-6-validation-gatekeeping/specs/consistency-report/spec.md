## ADDED Requirements

### Requirement: Per-chapter validation view
Any member of a story SHALL be able to view a published chapter's `validation_report` — every non-suppressed flag with its rule id, severity, and description — in read-only form.

#### Scenario: Member views a flagged chapter
- **WHEN** a story member opens a chapter that published with `warn` or `log` flags
- **THEN** the flags are displayed with their severities and originating rule descriptions

#### Scenario: Member views a clean chapter
- **WHEN** a story member opens a chapter whose `validation_report` is empty
- **THEN** the view indicates the chapter was evaluated with no issues, distinct from a chapter that predates this capability and was never evaluated

### Requirement: Per-story proposal history view
Any member of a story SHALL be able to view the story's `proposals` history — each proposal's text, verdict, reasoning, and whether it was later overridden — in read-only form.

#### Scenario: Member views proposal history
- **WHEN** a story member opens the story's consistency report
- **THEN** every evaluated proposal is listed with its verdict and reasoning, most recent first

#### Scenario: Overridden proposal shows override state
- **WHEN** a listed proposal's `gm_override` is true
- **THEN** the view indicates it was overridden, alongside the original verdict

### Requirement: Inline override for GM/owner
A user holding role `owner` or `gm` SHALL be able to trigger the `canon-exceptions` override action directly from the consistency report, on both a chapter's validation flags and the story's proposal history, without navigating to a separate screen.

#### Scenario: GM overrides from the report
- **WHEN** a `gm` viewing the consistency report selects the override action on a flagged item
- **THEN** the `canon-exceptions` override flow runs and the resulting exception is reflected in the report

#### Scenario: Non-GM sees no override action
- **WHEN** a `player` or `spectator` views the consistency report
- **THEN** no override action is presented to them

### Requirement: Read-only access for players and spectators
Players and spectators SHALL have read access to the consistency report identical in content to owner/GM, differing only in the absence of the override action.

#### Scenario: Player reads full report content
- **WHEN** a `player` opens the consistency report
- **THEN** they see the same flags, severities, and proposal history an owner or GM would see
