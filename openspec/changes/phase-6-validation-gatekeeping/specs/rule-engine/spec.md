## ADDED Requirements

### Requirement: Standard Rule Pack applied to every universe
The engine SHALL provide a Standard Rule Pack — dead/incapacitated entities cannot act, an entity cannot be in two locations simultaneously, destroyed items/locations remain destroyed, capability gating when a progression model with capability semantics is active, established canon facts must not be contradicted, and a submission's stated intent must be addressed — applied to every universe unless a `canon_exceptions` row disables a specific pack rule for that story. The pack MUST be expressed as data (rule objects with `applies_when`/`check`/`severity`), evaluated by the same code path as research-derived rules, with no conditional branching on genre, universe, or media type.

#### Scenario: Standard rule flags a dead entity acting
- **WHEN** a chapter draft depicts an entity whose `status` field is `dead` or an equivalent incapacitated state taking an action
- **THEN** the rule engine emits a flag for that rule at its configured severity

#### Scenario: Standard rule pack applies without a research-derived rule pack
- **WHEN** a universe version has an empty or absent `validation_rules`
- **THEN** the Standard Rule Pack still evaluates against every chapter draft in that universe

#### Scenario: Story disables one standard rule
- **WHEN** a `canon_exceptions` row scopes to a Standard Rule Pack rule id with no entity or capability restriction
- **THEN** the rule engine excludes that rule from evaluation for that story while still evaluating every other pack rule

### Requirement: Research-derived rule evaluation filtered by applicability
The engine SHALL evaluate a universe version's `validation_rules` (Stage 7 research output) against a chapter draft, filtering each rule by its `applies_when` condition (including `progression_model_in`) before evaluation. A rule whose `applies_when` does not match the story's active progression model(s) MUST NOT be evaluated or flagged.

#### Scenario: Rule scoped to an inactive progression model is skipped
- **WHEN** a `validation_rules` entry has `applies_when: {progression_model_in: ["ability_unlock"]}` and the story's universe uses `none`
- **THEN** the rule engine does not evaluate that rule and it cannot produce a flag

#### Scenario: Rule scoped to the active progression model is evaluated
- **WHEN** a `validation_rules` entry's `applies_when` matches the story's active progression model
- **THEN** the rule engine evaluates it against the chapter draft and emits a flag if violated

### Requirement: Severity classification
Every rule, engine-provided or research-derived, SHALL carry a `severity` of exactly one of `block`, `warn`, or `log`. The rule engine MUST attach the rule's declared severity to every flag it emits and MUST NOT itself decide what action follows from a severity — that is the validator loop's responsibility.

#### Scenario: Flag carries its rule's severity
- **WHEN** a rule with severity `block` is violated
- **THEN** the emitted flag records `severity: "block"` and the id of the rule that produced it

#### Scenario: Multiple violations at different severities
- **WHEN** a chapter draft violates one `block` rule and one `log` rule simultaneously
- **THEN** the rule engine emits both flags independently, each with its own severity

### Requirement: Canon exception suppression
The rule engine SHALL check each candidate flag against the story's `canon_exceptions` rows before emitting it. A flag whose rule id, entity, and capability match an exception's scope (per the `canon-exceptions` capability's scope-matching rules) MUST be suppressed — not emitted, not recorded as `log` — rather than downgraded.

#### Scenario: Exact scope match suppresses a flag
- **WHEN** a candidate flag's rule id, entity, and capability exactly match an existing `canon_exceptions` row's scope
- **THEN** the rule engine does not emit that flag

#### Scenario: Partial scope match does not suppress
- **WHEN** a `canon_exceptions` row is scoped to a specific entity and capability, and a candidate flag has the same rule id but a different entity
- **THEN** the rule engine still emits the flag

### Requirement: Pure evaluation function
`evaluateRules` SHALL be a pure function of its inputs — chapter draft, universe version's rules, relevant entity state, and pre-fetched `canon_exceptions` rows — with no side effects, no direct database access, and no model calls. It MUST return the complete set of flags for a single evaluation without partial results.

#### Scenario: Same inputs produce same output
- **WHEN** `evaluateRules` is called twice with identical arguments
- **THEN** it returns an identical set of flags both times

#### Scenario: No side effects
- **WHEN** `evaluateRules` runs
- **THEN** it does not write to the database, call a model, or mutate any of its input arguments
