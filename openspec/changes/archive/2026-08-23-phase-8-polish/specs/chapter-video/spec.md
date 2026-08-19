## ADDED Requirements

### Requirement: Videographer model role
The system SHALL define a `videographer` model role, resolved per-story via `resolveModel('videographer', story.model_config)` with a documented default provider/model, independent of every other role's configuration.

#### Scenario: Story with no videographer override
- **WHEN** a videographer-role call is made for a story whose `model_config` has no `videographer` entry
- **THEN** the call resolves to the documented default video-generation model and records the resolution as a fallback

### Requirement: Per-story video opt-in, off by default
Anime-style video generation SHALL be disabled by default for every story and enabled only when an `owner` or `gm` explicitly sets the story's video flag (`stories.turn_config.media.video`).

#### Scenario: Video off by default
- **WHEN** a new story is created
- **THEN** its video flag is disabled and no chapter of that story triggers video generation

#### Scenario: Owner enables video
- **WHEN** an owner or GM enables the video flag
- **THEN** chapters published after that point become eligible for video generation

#### Scenario: Non-GM cannot toggle
- **WHEN** a player or spectator attempts to change the video flag
- **THEN** the system SHALL reject the request

### Requirement: Asynchronous video generation job
When video is enabled and a chapter has at least one generated image, the system SHALL run video generation as a durable, asynchronous job seeded by the chapter's image(s) and prose, tracked via a `chapter_videos` row whose status a client can observe without polling a synchronous request.

#### Scenario: Job queued after image is ready
- **WHEN** a chapter's manga-panel image finishes generating and the story has video enabled
- **THEN** a `chapter_videos` row is created with status `queued` and a video-generation job is dispatched

#### Scenario: Status transitions are observable
- **WHEN** a video-generation job progresses from queued to running to complete or failed
- **THEN** the `chapter_videos` row's status reflects each transition and is readable by story members without the job holding open a request

#### Scenario: Video generation never blocks publication or illustration
- **WHEN** a video-generation job is queued, running, or fails
- **THEN** the chapter's published status and its generated images are unaffected

### Requirement: Video generation failure handling
A video-generation failure, including a failure after the provider has already billed for partial work, SHALL be recorded with a `usage_log` row and a `failed` status, and MUST be retryable independent of image or prompt generation.

#### Scenario: Provider job fails after billing
- **WHEN** the video-generation provider reports a failure after tokens/compute were already billed
- **THEN** a `usage_log` row records the cost and the `chapter_videos` row is marked `failed`

#### Scenario: Retry after failure
- **WHEN** an owner or GM retries a failed video-generation job
- **THEN** the system dispatches a new job reusing the chapter's existing image(s) rather than regenerating them

### Requirement: Video access control
Generated chapter videos SHALL be readable only by members of the owning story, except when served through a valid, unexpired share-link signed URL.

#### Scenario: Story member views video
- **WHEN** a story member requests a chapter's generated video
- **THEN** the system returns it if status is `complete`

#### Scenario: Non-member denied
- **WHEN** a user who is not a member of the story requests a chapter's generated video directly
- **THEN** the system denies access
