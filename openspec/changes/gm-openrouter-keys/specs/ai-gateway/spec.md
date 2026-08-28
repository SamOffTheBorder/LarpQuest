## MODIFIED Requirements

### Requirement: API key protection
Provider keys SHALL be encrypted at rest with AES-256-GCM using a master key held in the environment and never stored in the database. Keys MUST be decrypted server-side per request and MUST NOT be sent to the client. A user MAY supply their own OpenRouter key from account settings; when supplied, the gateway SHALL resolve the key for a given story by story role — the `gm` member's key, else the `owner`'s key, else the platform environment key — and MUST record which source was used.

#### Scenario: Key stored
- **WHEN** a user saves an OpenRouter key
- **THEN** only the ciphertext is persisted, the master key is read from the environment, and the plaintext is never returned to the client

#### Scenario: Key used
- **WHEN** the gateway makes a call
- **THEN** the key is decrypted in server-side code only, and no response payload or client bundle contains it

#### Scenario: Master key absent
- **WHEN** the master key is missing from the environment at startup
- **THEN** the application SHALL fail to start with an explicit configuration error rather than running with unprotected keys

#### Scenario: GM has supplied a key
- **WHEN** a story's `gm` member has a saved user-scoped OpenRouter key and a turn generates
- **THEN** the gateway decrypts and uses that key for the call and records the source as `gm`

#### Scenario: GM has no key but the owner does
- **WHEN** the `gm` member has no saved key but the story `owner` has one
- **THEN** the gateway uses the owner's key and records the source as `owner`

#### Scenario: No user key on the story
- **WHEN** neither the `gm` member nor the `owner` has a saved key
- **THEN** the gateway falls back to the platform `OPENROUTER_API_KEY` and records the source as `platform`

#### Scenario: User removes their key
- **WHEN** a user removes their saved key from account settings
- **THEN** the `api_keys` row is deleted and subsequent resolution for their stories falls through to the next source in order

#### Scenario: Cost still accounted on a user key
- **WHEN** a call runs on a GM's own OpenRouter key
- **THEN** a `usage_log` row is still written with the reported `cost_usd`, so per-story cost views remain accurate

### Requirement: Role-based model routing
Every model call SHALL declare its role from the defined role table and resolve its model string from the story's `model_config`. The system MUST NOT hardcode a model string at a call site. A GM SHALL be able to set the model for each text role from story settings, choosing either an entry from the live list of zero-priced OpenRouter models or an arbitrary model id typed by hand; a blank entry means the project default for that role.

#### Scenario: Narration call routes by role
- **WHEN** the engine generates a chapter
- **THEN** it requests the `narrator` role and the gateway resolves that role's model string from the story's `model_config`

#### Scenario: Role missing from configuration
- **WHEN** a story's `model_config` lacks an entry for a requested role
- **THEN** the gateway falls back to that role's documented default and records the fallback, rather than failing the call

#### Scenario: Roles are independently configurable
- **WHEN** the `narrator` and `extractor` roles are set to different models
- **THEN** each call uses the model for its own role

#### Scenario: GM picks a preset free model
- **WHEN** the GM opens story model settings and selects a model from the OpenRouter free-model list for the `narrator` role
- **THEN** that model id is persisted to `stories.model_config.narrator` and used on the next narration call

#### Scenario: GM enters an arbitrary model id
- **WHEN** the GM types a model id that is not in the preset list into a role's field and saves
- **THEN** the id is validated against `modelConfigSchema` (non-empty string) and persisted for that role

#### Scenario: Free-model list unavailable
- **WHEN** the OpenRouter models endpoint cannot be reached while rendering story model settings
- **THEN** a small hardcoded fallback list of known free model ids is offered and the free-text input still works

#### Scenario: GM clears a role override
- **WHEN** the GM blanks a previously set role field and saves
- **THEN** the entry is removed from `stories.model_config` and that role reverts to the project default
