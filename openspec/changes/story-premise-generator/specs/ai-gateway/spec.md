## MODIFIED Requirements

### Requirement: Role-based model routing
Every model call SHALL declare its role from the defined role table and resolve its model string from the story's `model_config`. The system MUST NOT hardcode a model string at a call site. Where a call runs before any story exists, it SHALL still declare its role and resolve through the role table's documented defaults.

#### Scenario: Narration call routes by role
- **WHEN** the engine generates a chapter
- **THEN** it requests the `narrator` role and the gateway resolves that role's model string from the story's `model_config`

#### Scenario: Role missing from configuration
- **WHEN** a story's `model_config` lacks an entry for a requested role
- **THEN** the gateway falls back to that role's documented default and records the fallback, rather than failing the call

#### Scenario: Roles are independently configurable
- **WHEN** the `narrator` and `extractor` roles are set to different models
- **THEN** each call uses the model for its own role

#### Scenario: Premise call routes by role
- **WHEN** the system generates a story premise
- **THEN** it requests the `premise` role and resolves that role's model rather than naming a model at the call site

#### Scenario: Call made before a story exists
- **WHEN** a premise is generated and there is no story whose `model_config` could be consulted
- **THEN** the gateway resolves the `premise` role to its documented default and records the fallback

#### Scenario: Existing story predates a newly added role
- **WHEN** a story created before the `premise` role existed is used for a call declaring that role
- **THEN** the gateway falls back to the role's default and records the fallback, rather than failing
