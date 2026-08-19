## ADDED Requirements

### Requirement: Illustrator model role
The system SHALL define an `illustrator` model role, resolved per-story via `resolveModel('illustrator', story.model_config)` with a documented default model, exactly as every other role is resolved. A story's `model_config` MAY override the `illustrator` role independently of every other role.

#### Scenario: Story with no illustrator override
- **WHEN** an illustrator-role call is made for a story whose `model_config` has no `illustrator` entry
- **THEN** the call resolves to the documented default illustrator model and records the resolution as a fallback

#### Scenario: Story with an illustrator override
- **WHEN** a story's `model_config` sets a specific model for `illustrator`
- **THEN** illustrator-role calls for that story use the configured model, not the default

### Requirement: Post-publish image prompt generation
After a chapter is published, the system SHALL generate one or more image-generation prompts describing the chapter's key visual moment(s) and write them to `chapters.image_prompts`. This step MUST run after publication and MUST NOT block or delay publication.

#### Scenario: Chapter publishes before prompts exist
- **WHEN** a chapter is published
- **THEN** the chapter is visible to story members immediately, with `image_prompts` initially null or absent, and prompt generation is queued separately

#### Scenario: Prompt generation succeeds
- **WHEN** the queued prompt-generation step completes successfully for a published chapter
- **THEN** `chapters.image_prompts` is populated with one or more prompts describing the chapter's content

#### Scenario: Prompt generation fails
- **WHEN** the illustrator-role call fails or returns output that fails schema validation after one retry
- **THEN** the chapter remains published, `image_prompts` remains unset, and the failure is queued for retry without affecting the chapter or any other capability

### Requirement: Image prompts are genre-agnostic
The prompt-generation system prompt SHALL derive its visual description entirely from the chapter's prose, entities, and universe schema, with no hardcoded reference to any specific genre, universe, or media type in the prompt-construction code.

#### Scenario: Two structurally different universes
- **WHEN** image prompts are generated for chapters from two universes with different entity schemas (e.g. one with a power system, one without)
- **THEN** both generate successfully through the same code path with no universe-specific branch
