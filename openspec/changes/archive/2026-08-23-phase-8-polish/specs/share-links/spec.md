## ADDED Requirements

### Requirement: Share link creation
An `owner` or `gm` SHALL be able to create a token-bearing public share link for a story, granting read-only access to that story's published chapters to anyone with the link, without requiring the visitor to authenticate.

#### Scenario: Owner creates a share link
- **WHEN** an owner or GM creates a share link for a story
- **THEN** the system generates a unique token and a public URL that renders the story's published chapters read-only

#### Scenario: Non-GM cannot create a share link
- **WHEN** a player or spectator attempts to create a share link
- **THEN** the system SHALL reject the request

### Requirement: Share link read-only scope
A visitor using a valid share link SHALL be able to view a story's published chapters and, where present, their generated images and videos, and MUST NOT be able to view entity sheets, submit turns, or mutate any story state.

#### Scenario: Visitor views chapters
- **WHEN** a visitor opens a valid share link
- **THEN** the story's published chapters are rendered read-only

#### Scenario: Visitor cannot access entity sheets
- **WHEN** a visitor with a valid share link attempts to view entity sheets or submit a turn
- **THEN** the system denies the action

#### Scenario: Unpublished content excluded
- **WHEN** a story has turns or chapters that are not yet published
- **THEN** a share-link visitor cannot see them

### Requirement: Share link revocation
An `owner` or `gm` SHALL be able to revoke a share link, after which the link MUST stop granting access to the story view and MUST NOT be usable to obtain any new signed media URL. A signed media URL already issued to a visitor before revocation remains valid until its own short expiry elapses — it is a self-contained credential the revocation cannot reach in-flight — so signed URLs MUST use a short time-to-live to bound this exposure window.

#### Scenario: Owner revokes a link
- **WHEN** an owner or GM revokes an active share link
- **THEN** subsequent requests using that link's token are denied

#### Scenario: Revoked link denies access
- **WHEN** a visitor attempts to use a token that has been revoked
- **THEN** the system denies access and does not render any story content

#### Scenario: Revocation stops new signed URLs
- **WHEN** a link is revoked
- **THEN** no further signed media URLs can be issued through that link, though a URL issued before revocation keeps working until its own short expiry
