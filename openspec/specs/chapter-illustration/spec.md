# chapter-illustration Specification

## Purpose

Manga-style panel image generation from a chapter's image prompts: per-story opt-in (default off), Storage-backed generation triggered from image-prompts, and access control.

## Requirements

### Requirement: Per-story illustration opt-in
Manga-style panel image generation SHALL be disabled by default for a story and enabled only when an `owner` or `gm` sets the story's illustration flag (`stories.turn_config.media.illustration`). Disabling the flag MUST stop future generation without deleting previously generated images.

#### Scenario: Illustration off by default
- **WHEN** a new story is created
- **THEN** its illustration flag is disabled and no chapter of that story triggers image generation

#### Scenario: Owner enables illustration
- **WHEN** an owner or GM enables the illustration flag
- **THEN** chapters published after that point are eligible for image generation

#### Scenario: Non-GM cannot toggle
- **WHEN** a player or spectator attempts to change the illustration flag
- **THEN** the system SHALL reject the request

### Requirement: Manga-panel image generation from prompts
When illustration is enabled for a story, the system SHALL render one or more manga-style panel images per published chapter from that chapter's `image_prompts`, store each image in Supabase Storage, and record it as a `chapter_images` row referencing the chapter.

#### Scenario: Generation triggered after prompts exist
- **WHEN** a chapter's image prompts are generated and the story has illustration enabled
- **THEN** an image-generation task is queued for that chapter

#### Scenario: Successful generation
- **WHEN** the image-generation call succeeds
- **THEN** the resulting image is stored and a `chapter_images` row is created with status `complete` and a storage reference

#### Scenario: Generation never blocks publication
- **WHEN** image generation is queued, in progress, or fails for a chapter
- **THEN** the chapter's published status and content are unaffected

#### Scenario: Manual regeneration
- **WHEN** an owner or GM requests regeneration of images for an already-published chapter
- **THEN** the system queues a new image-generation task for that chapter independent of whether prior images exist

### Requirement: Illustration failure handling
An image-generation failure SHALL record a `failed` status on the corresponding `chapter_images` row with an error, and MUST be retryable without re-running prompt generation or affecting the chapter.

#### Scenario: Image provider call fails
- **WHEN** the image-generation gateway call errors or times out
- **THEN** the `chapter_images` row is marked `failed` and a `usage_log` row is written for the attempt

#### Scenario: Retry after failure
- **WHEN** a failed image-generation task is retried
- **THEN** it reuses the chapter's existing image prompts rather than regenerating them

### Requirement: Illustration access control
Generated chapter images SHALL be readable only by members of the owning story, except when served through a share-link-derived signed URL (see the `share-links` capability — such a URL remains valid until its own short expiry even after the originating link is revoked).

#### Scenario: Story member reads image
- **WHEN** a story member requests a chapter's generated image
- **THEN** the system returns it

#### Scenario: Non-member denied
- **WHEN** a user who is not a member of the story requests a chapter's generated image directly (not via a share link)
- **THEN** the system denies access
