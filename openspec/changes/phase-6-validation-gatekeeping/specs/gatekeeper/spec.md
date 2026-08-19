## ADDED Requirements

### Requirement: Proposal evaluation against universe rules and entity state
When a turn's submissions include a `proposals` payload, the system SHALL evaluate each proposal with a model call declaring role `gatekeeper`, resolved from `stories.model_config`, given the universe's rules, its active progression model(s), and the proposing entity's current state. The evaluation MUST run after context assembly and before the Narrator call for that turn, so the Narrator receives the ruling as an input. This MUST be the same evaluation path regardless of which progression model, genre, or universe is active.

#### Scenario: Proposal present triggers evaluation
- **WHEN** a turn's submissions include a non-empty `proposals` payload
- **THEN** the Gatekeeper evaluates it before the Narrator generates the chapter

#### Scenario: No proposal skips evaluation
- **WHEN** none of a turn's submissions include a `proposals` payload
- **THEN** the Gatekeeper does not run for that turn and no `proposals` row is written

#### Scenario: Evaluation is progression-model-agnostic
- **WHEN** a proposal is evaluated in a story using `ability_unlock` and, separately, one using `none`
- **THEN** the same Gatekeeper code path runs for both, differing only in which universe rules and entity fields are supplied as input, with no branch naming either model

### Requirement: Structured verdict output
The Gatekeeper's output SHALL be parsed through a Zod schema requiring `verdict` (`allow`, `allow_with_limits`, or `reject`), `reasoning`, and MAY include `imposed_limits`, `suggested_alternative`, and `narrative_cost`. On a parse failure the system MUST retry once with the parse error appended to the prompt, then raise a typed error if the retry also fails to parse.

#### Scenario: Valid verdict parses
- **WHEN** the Gatekeeper's response parses against the verdict schema
- **THEN** the parsed verdict is used for both the `proposals` row and the Narrator prompt

#### Scenario: Malformed output retried once
- **WHEN** the Gatekeeper's response fails Zod parsing
- **THEN** the system retries once with the parse error appended

#### Scenario: Retry exhaustion raises typed error and turn fails
- **WHEN** the retried Gatekeeper response also fails Zod parsing
- **THEN** the system raises a typed error and the turn transitions to `failed`, since a proposal that could not be ruled on must not reach the Narrator un-adjudicated

### Requirement: Proposals table
Every evaluated proposal SHALL be persisted as a row in a `proposals` table (`story_id`, `entity_id`, `proposal`, `verdict`, `reasoning`, `imposed_limits`, `suggested_alternative`, `narrative_cost`, `gm_override`, `created_at`), gated by RLS through `story_members` matching the story's existing access pattern. `gm_override` MUST default to false and MUST only ever be set true by the `canon-exceptions` capability's override action — never by the Gatekeeper call itself.

#### Scenario: Row written on evaluation
- **WHEN** the Gatekeeper produces a parsed verdict for a proposal
- **THEN** a `proposals` row is written with that verdict before the Narrator call begins

#### Scenario: Access gated through membership
- **WHEN** a user who is not a member of the proposal's story attempts to read the `proposals` row
- **THEN** the request is rejected by RLS

### Requirement: Ruling threaded into Narrator prompt
The Gatekeeper's verdict for a turn SHALL be included in the Narrator's prompt input for that same turn, so a `reject` or `allow_with_limits` verdict is reflected in the generated prose rather than the Narrator writing as if the original proposal succeeded unconditionally.

#### Scenario: Rejected proposal reflected in prose
- **WHEN** a proposal receives verdict `reject`
- **THEN** the Narrator's prompt includes the rejection and its reasoning, so the resulting chapter can depict the attempt failing or being refused in-fiction

#### Scenario: Allowed-with-limits proposal reflected in prose
- **WHEN** a proposal receives verdict `allow_with_limits`
- **THEN** the Narrator's prompt includes the imposed limits, so the resulting chapter can depict the capability manifesting within those limits

### Requirement: Gatekeeper usage logging
Every Gatekeeper call MUST write a `usage_log` row regardless of outcome, including calls that fail after tokens were billed, matching the logging behavior required of every other model role.

#### Scenario: Usage logged on success
- **WHEN** a Gatekeeper call completes and parses successfully
- **THEN** a `usage_log` row is written recording role `gatekeeper` and the resolved model

#### Scenario: Usage logged on failure
- **WHEN** a Gatekeeper call fails after the provider billed tokens
- **THEN** a `usage_log` row is still written for that call
