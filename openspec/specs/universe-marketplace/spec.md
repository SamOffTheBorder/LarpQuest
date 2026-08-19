# universe-marketplace Specification

## Purpose

Public browsing of universes marked `is_public`, and cloning one into a fully independent, separately-owned fork.

## Requirements

### Requirement: Public universe browsing
The system SHALL let any authenticated user browse universes where `is_public = true`, regardless of who owns them, without requiring story membership.

#### Scenario: Browsing public universes
- **WHEN** an authenticated user requests the marketplace listing
- **THEN** the system returns universes with `is_public = true`, including universes the user does not own

#### Scenario: Private universes excluded
- **WHEN** an authenticated user requests the marketplace listing
- **THEN** universes with `is_public = false` that the user does not own are excluded

### Requirement: Universe clone/fork
An authenticated user SHALL be able to clone a public universe into a new, independently-owned universe at version 1, copying the source universe's latest published version's content — entity schema, progression model and its configuration, context policy, compressed canon bible, and validation rules — with `forked_from` set to the original universe's id.

#### Scenario: Cloning a public universe
- **WHEN** a user clones a public universe
- **THEN** a new `universes` row is created, owned by the cloning user, with `forked_from` set to the original, and a new `universe_versions` row at version 1 copying the source's latest version's content

#### Scenario: Fork independence
- **WHEN** the original universe is edited or versioned after a fork is created
- **THEN** the forked universe's content is unaffected

#### Scenario: Cannot clone a private universe
- **WHEN** a user attempts to clone a universe with `is_public = false` that they do not own
- **THEN** the system denies the request
