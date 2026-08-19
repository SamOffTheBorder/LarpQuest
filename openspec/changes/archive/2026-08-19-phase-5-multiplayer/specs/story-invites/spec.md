## ADDED Requirements

### Requirement: Invite creation
An owner or GM SHALL be able to create an invite for their story naming a role (`gm`, `player`, or `spectator`) the joining user will receive. The system MUST generate a unique, unguessable token and record an expiry.

#### Scenario: Owner creates a player invite
- **WHEN** the story owner creates an invite with role `player`
- **THEN** a `story_invites` row is created with a unique token, `role: player`, `created_by` the owner, and a default expiry

#### Scenario: Player cannot create an invite
- **WHEN** a user with role `player` attempts to create an invite
- **THEN** the system SHALL reject the request

#### Scenario: Invite cannot grant owner
- **WHEN** an invite is created naming role `owner`
- **THEN** the system SHALL reject the request, since ownership does not transfer via invite

### Requirement: Joining via invite
A user visiting a valid invite link SHALL be added to `story_members` with the role recorded on the invite. An invite that is expired, revoked, or exhausted MUST NOT admit a new member.

#### Scenario: Valid invite joined
- **WHEN** an authenticated user who is not already a member submits a valid, unexpired, unrevoked invite token
- **THEN** a `story_members` row is created for that user with the invite's role, and the invite's use count increments

#### Scenario: Expired invite rejected
- **WHEN** a user submits a token whose `expires_at` has passed
- **THEN** the system SHALL reject the join and no membership row is created

#### Scenario: Revoked invite rejected
- **WHEN** a user submits a token that has been revoked
- **THEN** the system SHALL reject the join and no membership row is created

#### Scenario: Already-member rejoin is a no-op
- **WHEN** a user who is already a member of the story submits a valid invite token
- **THEN** the system SHALL leave their existing role unchanged rather than creating a duplicate or downgrading membership

### Requirement: Invite revocation
An owner or GM SHALL be able to revoke an invite at any time, immediately preventing further joins through it.

#### Scenario: Owner revokes an active invite
- **WHEN** the owner revokes an invite that has not expired
- **THEN** the invite's `revoked_at` is set and any subsequent join attempt using its token is rejected

#### Scenario: Revoking an already-used invite does not remove existing members
- **WHEN** an invite that has already admitted one or more members is revoked
- **THEN** members who joined before revocation remain members; revocation only blocks future joins
