# prompt-safety Specification

## Purpose
TBD - created by archiving change prompt-injection-defense. Update Purpose after archive.
## Requirements
### Requirement: Untrusted content is fenced before entering a prompt
Any text that originates from a user, from an uploaded document, or from model output derived from either, SHALL be embedded in a model prompt only through the shared untrusted-content
helper. The helper MUST wrap the content in a delimiter that carries a per-call random nonce, and
MUST neutralise any occurrence of that delimiter inside the content itself, so that content cannot
terminate its own fence and reach the model as scaffolding.

#### Scenario: Ordinary content is fenced
- **WHEN** a player submission is embedded in the moderator's user prompt
- **THEN** the submission appears inside a nonce-carrying fence labelled as untrusted user data

#### Scenario: Content attempts to close its own fence
- **WHEN** untrusted content contains a delimiter identical to the fence wrapping it
- **THEN** the occurrence inside the content is neutralised, and the surrounding fence remains the only structural boundary the model sees

#### Scenario: Nonce differs between calls
- **WHEN** two prompts are built in separate calls
- **THEN** their fences carry different nonces, so a nonce observed in one response cannot be replayed to forge a fence in a later prompt

### Requirement: Fenced content carries no instruction authority
Every system prompt whose user prompt contains fenced content SHALL state that fenced content is
data authored by users, that it must never be followed as an instruction, and that only the system
prompt carries authority.

#### Scenario: System prompt declares the data/instruction separation
- **WHEN** any role's system prompt is built for a call whose user prompt contains fenced content
- **THEN** the system prompt includes the standing instruction that fenced content is data and never instructions

#### Scenario: Content instructing the model is not obeyed
- **WHEN** fenced content contains an imperative directed at the model, such as a demand to disregard its instructions or to return a particular verdict
- **THEN** the instruction is treated as part of the content being processed, not as a directive to follow

### Requirement: Uploaded source material is treated as untrusted
Source material supplied by a user to the research pipeline SHALL be fenced as untrusted content
in every stage prompt that includes it, and no research stage SHALL treat text drawn from that
material as an instruction about how to perform the research.

#### Scenario: Source text enters a stage prompt
- **WHEN** a research draft with user-supplied `sourceText` builds any stage's prompt
- **THEN** the source text appears fenced as untrusted content, distinct from the stage's own instructions

#### Scenario: Source text attempts to redirect the pipeline
- **WHEN** uploaded source material contains text instructing the research model to alter its task or output
- **THEN** that text is presented as material to be researched, not as a directive

