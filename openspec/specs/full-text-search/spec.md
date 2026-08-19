# full-text-search Specification

## Purpose

Keyword search across a story's chapters and entities using Postgres full-text search, scoped to story membership.

## Requirements

### Requirement: Search scoped to story membership
Full-text search over a story's chapters and entities SHALL be available only to members of that story, and MUST NOT return results from a story the requesting user is not a member of.

#### Scenario: Member searches their story
- **WHEN** a story member submits a search query for that story
- **THEN** matching chapters and entities from that story are returned

#### Scenario: Non-member search rejected
- **WHEN** a user who is not a member of a story attempts to search it
- **THEN** the system denies the request and returns no results

### Requirement: Chapter and entity indexing
The system SHALL index chapter prose and summary, and entity name and data, into searchable text representations kept in sync as chapters are published and entities are created or updated.

#### Scenario: New chapter becomes searchable
- **WHEN** a chapter is published
- **THEN** its prose and summary become searchable without a separate manual indexing step

#### Scenario: Updated entity becomes searchable
- **WHEN** an entity's name or data is updated
- **THEN** subsequent searches reflect the updated content

### Requirement: Keyword query interface
The system SHALL accept a free-text query and return ranked matches across a story's chapters and entities, distinguishing which kind of record each result is.

#### Scenario: Query matches a chapter
- **WHEN** a search query matches text in a chapter's prose or summary
- **THEN** that chapter appears in the results, identified as a chapter

#### Scenario: Query matches an entity
- **WHEN** a search query matches an entity's name or data
- **THEN** that entity appears in the results, identified as an entity

#### Scenario: No matches
- **WHEN** a search query matches nothing in the story
- **THEN** the system returns an empty result set, not an error
