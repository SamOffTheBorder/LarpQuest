## MODIFIED Requirements

### Requirement: Role-based model routing
Every model call SHALL declare its role from the defined role table and resolve its model string from the story's `model_config`. The system MUST NOT hardcode a model string at a call site. The role table SHALL include a `character` role for character drafting, defaulting to the same creative tier as `narrator` and configurable per story alongside the other text roles.

#### Scenario: Narration call routes by role
- **WHEN** the engine generates a chapter
- **THEN** it requests the `narrator` role and the gateway resolves that role's model string from the story's `model_config`

#### Scenario: Role missing from configuration
- **WHEN** a story's `model_config` lacks an entry for a requested role
- **THEN** the gateway falls back to that role's documented default and records the fallback, rather than failing the call

#### Scenario: Roles are independently configurable
- **WHEN** the `narrator` and `extractor` roles are set to different models
- **THEN** each call uses the model for its own role

#### Scenario: Character generation routes by role
- **WHEN** a GM generates a character draft
- **THEN** the call requests the `character` role and the gateway resolves that role's model string from the story's `model_config`

#### Scenario: Existing story predates the character role
- **WHEN** a story whose `model_config` was written before the `character` role existed generates a character
- **THEN** the gateway falls back to the documented default for `character` and records the fallback, rather than failing the call
