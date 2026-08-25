# account-data-export Specification

## Purpose

Self-serve export of a user's own account data as a single JSON file, independent of and prior to account deletion — a copy of profile, story memberships, submissions, filed reports, usage history, and API key metadata, drawing the same "user data vs. story content" boundary account deletion already established.

## Requirements

### Requirement: Self-serve account data export
The system SHALL let a signed-in user download a single JSON file containing the data this schema attributes to them personally: profile and appearance preferences, story memberships (story, role, joined date — not other members or story prose), their own submissions, reports they filed, their usage/spend history, and metadata for API keys they own.

#### Scenario: User requests their export
- **WHEN** a signed-in user requests their account export
- **THEN** the system returns a JSON file containing their profile, preferences, story memberships, submissions, filed reports, usage history, and API key metadata

#### Scenario: Export excludes other users' data
- **WHEN** a user who belongs to a story with other members requests their export
- **THEN** the export contains none of those other members' identities, submissions, or personal data

#### Scenario: Export excludes story prose
- **WHEN** a user requests their export
- **THEN** the export does not include story chapters or other collaborative story content, consistent with account deletion treating story content as distinct from the user's own data

#### Scenario: Export excludes decrypted key material
- **WHEN** a user who owns one or more API keys requests their export
- **THEN** the export includes each key's label, scope, and creation date but never the encrypted key ciphertext

#### Scenario: A user with no story history still gets an export
- **WHEN** a newly signed-up user with no stories, submissions, or usage requests their export
- **THEN** the system returns a valid JSON file with empty collections rather than an error
