## ADDED Requirements

### Requirement: OpenRouter key management in account settings
A signed-in user SHALL be able to save, fingerprint, and remove their own OpenRouter API key from an account settings page. The key is stored encrypted (per the ai-gateway API key protection requirement) as a single user-scoped `api_keys` row per user, and the plaintext is never rendered, returned to the client after save, or logged.

#### Scenario: User saves a key
- **WHEN** a signed-in user enters an OpenRouter key on `/settings/openrouter` and submits
- **THEN** the key is encrypted and stored as a `scope='user'`, `provider='openrouter'` row owned by that user, and the page shows a masked fingerprint (last 4 characters) and the saved time

#### Scenario: User replaces an existing key
- **WHEN** a user who already has a saved key saves a new one
- **THEN** the existing row is replaced so at most one user-scoped OpenRouter key exists per user

#### Scenario: User removes their key
- **WHEN** a user chooses Remove on `/settings/openrouter`
- **THEN** the `api_keys` row is deleted and the page returns to the empty state

#### Scenario: Plaintext never leaves the server
- **WHEN** the settings page renders for a user with a saved key
- **THEN** only the fingerprint and metadata are sent to the client; the decrypted key is never present in the page payload

#### Scenario: Empty or malformed submission
- **WHEN** a user submits a blank field or a value failing a basic format check
- **THEN** the action returns a validation error and nothing is written

#### Scenario: Unauthenticated access
- **WHEN** a request without a valid session hits `/settings/openrouter` or its actions
- **THEN** it is redirected to sign-in by the existing session enforcement, and no key operation runs
