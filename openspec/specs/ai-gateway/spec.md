# ai-gateway Specification

## Purpose

The OpenRouter client: per-role model routing resolved from `stories.model_config`, Zod-validated structured output, streaming generation with partial save, `usage_log` cost accounting, and encrypted-at-rest provider API keys.

## Requirements

### Requirement: Role-based model routing
Every model call SHALL declare its role from the defined role table and resolve its model string from the story's `model_config`. The system MUST NOT hardcode a model string at a call site.

#### Scenario: Narration call routes by role
- **WHEN** the engine generates a chapter
- **THEN** it requests the `narrator` role and the gateway resolves that role's model string from the story's `model_config`

#### Scenario: Role missing from configuration
- **WHEN** a story's `model_config` lacks an entry for a requested role
- **THEN** the gateway falls back to that role's documented default and records the fallback, rather than failing the call

#### Scenario: Roles are independently configurable
- **WHEN** the `narrator` and `extractor` roles are set to different models
- **THEN** each call uses the model for its own role

### Requirement: Structured output is schema-validated
Every model response that is consumed as structured data SHALL be parsed through a Zod schema before use. Unvalidated model output MUST NOT reach the database.

#### Scenario: Valid structured output
- **WHEN** the extractor returns JSON matching its schema
- **THEN** the parsed value is used and its type is guaranteed by the schema

#### Scenario: Malformed structured output
- **WHEN** a model returns JSON that fails schema validation
- **THEN** the gateway SHALL retry once with the validation error appended to the prompt, and on a second failure raise a typed error without writing anything

#### Scenario: Non-JSON response
- **WHEN** a model returns prose where JSON was required
- **THEN** the response is treated as a validation failure and follows the same retry path

### Requirement: Streaming generation with partial save
Narration SHALL stream, and partial output MUST be persisted as it arrives so a timeout does not discard already-generated tokens.

#### Scenario: Generation times out mid-stream
- **WHEN** a narration stream times out after partial output has arrived
- **THEN** the partial prose is retained with the turn marked `failed`, and the user can retry or salvage the partial text rather than losing it

#### Scenario: Stream completes
- **WHEN** the stream finishes normally
- **THEN** the accumulated prose is persisted as the chapter and the turn advances to `published`

### Requirement: Cost accounting on every call
Every model call SHALL write a `usage_log` row recording the story, the role, the model, prompt and completion tokens, and computed cost. The running cost of a story MUST be visible in the UI.

#### Scenario: Successful call logged
- **WHEN** any model call completes
- **THEN** a `usage_log` row is written with its role, model, token counts, and cost

#### Scenario: Failed call logged
- **WHEN** a model call fails after the provider has already billed tokens
- **THEN** the consumed tokens are still logged, so cost reporting is not understated by failures

#### Scenario: Cost shown to the user
- **WHEN** a user views a story
- **THEN** the story's cumulative cost is displayed without requiring a separate navigation

### Requirement: API key protection
Provider keys SHALL be encrypted at rest with AES-256-GCM using a master key held in the environment and never stored in the database. Keys MUST be decrypted server-side per request and MUST NOT be sent to the client.

#### Scenario: Key stored
- **WHEN** a user saves an OpenRouter key
- **THEN** only the ciphertext is persisted, and the master key is read from the environment

#### Scenario: Key used
- **WHEN** the gateway makes a call
- **THEN** the key is decrypted in server-side code only, and no response payload or client bundle contains it

#### Scenario: Master key absent
- **WHEN** the master key is missing from the environment at startup
- **THEN** the application SHALL fail to start with an explicit configuration error rather than running with unprotected keys
</content>
