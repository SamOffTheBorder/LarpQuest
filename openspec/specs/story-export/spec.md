# story-export Specification

## Purpose

Markdown/PDF/EPUB export of a story's published chapters, access-scoped to story members, tracked via an `export_jobs` row.

## Requirements

### Requirement: Export formats
The system SHALL allow a story member to export a story's published chapters as Markdown, PDF, or EPUB, with Markdown as the base render that PDF and EPUB are generated from.

#### Scenario: Markdown export
- **WHEN** a story member requests a Markdown export
- **THEN** the system produces a Markdown document containing the story's published chapters in turn order

#### Scenario: PDF export
- **WHEN** a story member requests a PDF export
- **THEN** the system produces a PDF rendered from the same content as the Markdown export

#### Scenario: EPUB export
- **WHEN** a story member requests an EPUB export
- **THEN** the system produces a valid EPUB file containing the story's published chapters

### Requirement: Export access control
Export SHALL be available only to members of the story being exported, scoped to chapters those members have read access to.

#### Scenario: Member exports their story
- **WHEN** a story member requests an export
- **THEN** the export includes only chapters visible to that member

#### Scenario: Non-member cannot export
- **WHEN** a user who is not a story member requests an export
- **THEN** the system denies the request

### Requirement: Export job tracking
Every export request SHALL be tracked by an `export_jobs` row recording its format and status, and MUST produce a downloadable result once complete. Generation MAY run synchronously within the request or as a separate background step; either way the job's status and resulting download MUST be queryable through the same `export_jobs` shape.

#### Scenario: Export job recorded
- **WHEN** a story member requests an export
- **THEN** an `export_jobs` row is created with status `queued`, transitioning to `complete` or `failed` once generation finishes

#### Scenario: Export job completes
- **WHEN** export generation finishes successfully
- **THEN** the `export_jobs` row transitions to `complete` and a downloadable file becomes available to the requesting member

#### Scenario: Export job fails
- **WHEN** export generation fails
- **THEN** the `export_jobs` row transitions to `failed` with an error, and the member can retry the export
