## MODIFIED Requirements

### Requirement: Share link creation
An `owner` or `gm` SHALL be able to create a token-bearing public share link for a story, granting read-only access to that story's published chapters to anyone with the link, without requiring the visitor to authenticate. Share link creation SHALL be rate-limited per user, matching the same discipline applied to every other request-scoped action in this deployment.

#### Scenario: Owner creates a share link
- **WHEN** an owner or GM creates a share link for a story
- **THEN** the system generates a unique token and a public URL that renders the story's published chapters read-only

#### Scenario: Non-GM cannot create a share link
- **WHEN** a player or spectator attempts to create a share link
- **THEN** the system SHALL reject the request

#### Scenario: Rate limit exceeded
- **WHEN** an owner or GM creates share links beyond the configured rate limit within its window
- **THEN** the system SHALL reject the request until the window resets
