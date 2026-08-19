# conflict-resolution Specification

## Purpose
TBD - created by archiving change phase-5-multiplayer. Update Purpose after archive.
## Requirements
### Requirement: Story conflict policy
A story SHALL have a `conflict_policy` of `narrative_priority`, `initiative_order`, `gm_ruling`, or `both_partially_succeed`, defaulting to `narrative_priority`, set at story creation.

#### Scenario: Story created without specifying a policy
- **WHEN** a story is created without a `conflict_policy`
- **THEN** it is stored as `narrative_priority`

#### Scenario: Story created with an explicit policy
- **WHEN** a story is created with `conflict_policy: gm_ruling`
- **THEN** that value is stored and used for every subsequent turn in the story

### Requirement: Conflict policy shapes the Narrator prompt
When a turn is generated, the Narrator system prompt MUST include an instruction derived from the story's `conflict_policy`, resolved through a fixed lookup keyed by policy value. No engine code may branch on the story's genre or universe to determine this instruction.

#### Scenario: Contradictory submissions in one turn
- **WHEN** two submissions in the same turn describe contradictory actions and the story's policy is `narrative_priority`
- **THEN** the Narrator prompt includes the `narrative_priority` instruction, and the resulting chapter's prose makes its resolution reasoning visible

#### Scenario: Policy lookup is universe-independent
- **WHEN** two different universes' stories both use `conflict_policy: initiative_order`
- **THEN** both receive the identical `initiative_order` instruction text, regardless of universe or genre

