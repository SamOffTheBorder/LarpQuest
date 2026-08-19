# validator-loop Specification

## Purpose

The `validating` turn state, block/warn/log handling, regenerate-with-violation-appended up to 2 retries, escalation to `failed` on exhaustion, and `chapters.validation_report` population.

## Requirements

### Requirement: Validating turn state
A turn SHALL transition from `generating` to `validating` once a chapter draft is produced, before it becomes visible as `published`. The `validating` state MUST run the rule engine against the draft and MUST determine the turn's next transition solely from the resulting flags' severities, with no conditional branching on the story's genre or universe.

#### Scenario: Draft enters validation
- **WHEN** generation produces a complete chapter draft
- **THEN** the turn transitions from `generating` to `validating` and the rule engine evaluates the draft

#### Scenario: No violations
- **WHEN** the rule engine returns no flags, or only flags with severity `log`
- **THEN** the turn transitions from `validating` to `published`, and any `log` flags are recorded in `chapters.validation_report`

### Requirement: Block severity triggers regeneration with retry cap
A `block`-severity flag SHALL prevent publication and trigger regeneration with the violation appended to the Narrator prompt. The system MUST allow at most 2 such retries per turn. On the third `block` result, the turn MUST transition to `failed` with a `failure_reason` naming the blocking rule(s), rather than retrying again.

#### Scenario: First block triggers retry
- **WHEN** validation of the first draft returns a `block`-severity flag
- **THEN** the turn transitions `validating -> generating`, the violation is appended to the Narrator's prompt, and `attempt_count` increments

#### Scenario: Second consecutive block also retries
- **WHEN** the regenerated draft still contains a `block`-severity flag and this is the second attempt
- **THEN** the turn retries once more, consistent with the 2-retry cap

#### Scenario: Retry exhaustion escalates
- **WHEN** a third draft still contains a `block`-severity flag
- **THEN** the turn transitions to `failed`, `failure_reason` names the blocking rule(s), and the turn is not retried automatically

#### Scenario: Submissions survive a block-triggered retry
- **WHEN** a turn is regenerated due to a `block` flag
- **THEN** the turn's submissions are unchanged and reused verbatim for the new generation attempt

### Requirement: Warn severity publishes with a visible flag
A `warn`-severity flag SHALL NOT prevent publication. The turn MUST transition `validating -> published`, and the flag MUST be recorded in `chapters.validation_report` in a way the consistency report surfaces prominently.

#### Scenario: Warn-only draft publishes
- **WHEN** the rule engine returns only `warn`-severity flags (and/or `log`-severity flags)
- **THEN** the turn publishes and `chapters.validation_report` records the warn flags for GM/owner review

### Requirement: Validator model call
The rule engine's evaluation of a chapter draft MAY be assisted by a model call declaring role `validator`, resolved from `stories.model_config` with the documented default fallback. Any such call's output MUST be parsed through a Zod schema, retried once with the parse error appended to the prompt on failure, and raise a typed error on a second failure. Every validator call MUST write a `usage_log` row, including on failure after tokens were billed.

#### Scenario: Valid structured output
- **WHEN** a validator model call returns output that parses against its Zod schema
- **THEN** the parsed result is used and a `usage_log` row is written

#### Scenario: Invalid output retried once
- **WHEN** a validator model call's output fails Zod parsing
- **THEN** the system retries once with the parse error appended to the prompt

#### Scenario: Retry exhaustion raises typed error
- **WHEN** the retried validator call's output also fails Zod parsing
- **THEN** the system raises a typed error and the turn transitions to `failed`

#### Scenario: Usage logged on failure
- **WHEN** a validator call fails after tokens were billed by the model provider
- **THEN** a `usage_log` row is still written for that call

### Requirement: Validation report on published chapters
Every published chapter SHALL have `chapters.validation_report` populated with the complete set of non-suppressed flags produced during its validation (across all attempts), each recording the originating rule id, severity, and a human-readable description.

#### Scenario: Clean chapter has an empty report
- **WHEN** a chapter publishes with no flags at any severity
- **THEN** `validation_report` is recorded as an empty result, not left null, so the consistency report can distinguish "evaluated, no issues" from "not yet evaluated"

#### Scenario: Chapter with mixed severities
- **WHEN** a chapter publishes after producing both `warn` and `log` flags on its final accepted draft
- **THEN** `validation_report` includes both, each tagged with its severity
