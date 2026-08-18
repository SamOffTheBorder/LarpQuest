## ADDED Requirements

### Requirement: Per-universe-version context policy
Each `universe_versions` row SHALL carry a `context_policy` describing `recent_chapters`, `retrieved_chapters`, `retrieval_bias` (`precedent|information|emotional|thematic`), `canon_compression` (`full|summary|rules_only`), and `token_budget`, defaulted for versions that predate this policy.

#### Scenario: New universe version has a context policy
- **WHEN** a universe version is published
- **THEN** its `context_policy` is present with all five fields set, either from explicit input or documented defaults

#### Scenario: Pre-existing universe versions default rather than break
- **WHEN** `assembleContext` reads a universe version published before this change shipped
- **THEN** it uses the documented default policy values rather than erroring on a missing `context_policy`

#### Scenario: Policy is immutable per version
- **WHEN** a universe publishes a new version
- **THEN** the new version's `context_policy` is independent of the prior version's, and stories pinned to the prior version keep its policy unchanged

### Requirement: Compressed canon bible generated at universe-version publish
When `canon_compression` calls for a `summary` or `rules_only` representation of the canon bible, that representation SHALL be generated synchronously during universe-version publish and stored on the version row, so `assembleContext` never reads a version with a missing compressed variant it is configured to use.

#### Scenario: Publish produces all compression variants
- **WHEN** a universe version is published
- **THEN** the version row is written with `entity_schema` and both compressed canon-bible variants (`summary` and `rules_only`) present before publish returns

#### Scenario: Context assembly never sees a partially-ready version
- **WHEN** `assembleContext` reads a published universe version's compressed canon bible for the compression level its policy specifies
- **THEN** the corresponding field is always populated, never null, for any version that completed publishing
