# auth-and-accounts Specification

## Purpose

Magic-link sign-in via Supabase Auth, server-side session enforcement on every protected route, and the RLS gating pattern (through `story_members`) that all later story-scoped tables inherit.

## Requirements

### Requirement: Magic-link authentication
The system SHALL authenticate users through Supabase Auth magic links. The system MUST NOT store passwords.

#### Scenario: New user signs in
- **WHEN** a visitor submits an email address on the sign-in page
- **THEN** Supabase Auth sends a magic link to that address and the UI reports that the link was sent, without revealing whether the address already had an account

#### Scenario: User follows a valid magic link
- **WHEN** a user opens a magic link that has not expired or been consumed
- **THEN** the system establishes a session, persists it in cookies readable by server components, and redirects to the story list

#### Scenario: User follows an expired or reused link
- **WHEN** a user opens a magic link that has expired or was already consumed
- **THEN** the system SHALL show a recoverable error offering to send a new link, and MUST NOT establish a session

### Requirement: Session enforcement on protected routes
Every route that reads or writes story data SHALL resolve the caller's session server-side before performing any database work.

#### Scenario: Unauthenticated request to a protected route
- **WHEN** a request without a valid session reaches any story, turn, or entity route
- **THEN** the system redirects browser requests to sign-in and returns HTTP 401 for API requests, having performed no database read or write

#### Scenario: Client-supplied identity is ignored
- **WHEN** a request includes a user id in its body, query string, or headers
- **THEN** the system SHALL derive the acting user only from the server-side session and ignore the client-supplied value

### Requirement: Row Level Security on every table
RLS SHALL be enabled on every table in the first migration that creates it. Access to story-scoped rows MUST be gated through a membership check against `story_members`, even while the owner is the only possible member in this phase.

#### Scenario: User reads a story they do not belong to
- **WHEN** an authenticated user queries a story, entity, chapter, turn, or submission belonging to a story for which they have no `story_members` row
- **THEN** the query returns zero rows

#### Scenario: Table added without a policy
- **WHEN** a migration creates a table without enabling RLS and defining a policy
- **THEN** the migration test suite SHALL fail

#### Scenario: Service-role work stays server-side
- **WHEN** engine code needs to bypass RLS to write generated content
- **THEN** it SHALL use the service-role key only in server-side code paths, and the service-role key MUST NOT be exposed to the client bundle
</content>
