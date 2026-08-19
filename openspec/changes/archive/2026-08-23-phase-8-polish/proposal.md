## Why

Phase 7 (Turn Modes) is complete and archived. Part 10 of `STORYFORGE_BUILD_PLAN.md` puts Phase 8 — Polish last in the fixed build order, and its exit condition is implicit: every other phase's surface area now exists, so this is the first point at which cross-cutting, story-spanning features (search, export, sharing, a real design pass) can be built against a stable engine instead of a moving one. `chapters.image_prompts jsonb` has sat unused since the Part 8.2 schema was first created in Phase 1; no capability writes to it yet. Without this phase, a story's only interface is the in-app turn loop — chapters cannot be found by content, taken out of the app, shown to someone without an account, or illustrated, and universes cannot be discovered by anyone who did not create them.

This change goes beyond the build plan's literal Phase 8 scope at the user's explicit request: on top of text image-prompt generation, it adds actual per-chapter manga-panel image generation and anime-style video generation, so a chapter can produce not just prose but a rendered visual artifact a player can look at.

## What Changes

- **Image prompt generation**: a new `illustrator` model role, resolved per-story like every other role, generates one or more image-generation prompts per published chapter (Part 8.2's `chapters.image_prompts jsonb` column is the target). Runs after publication, alongside extraction, never blocking it — same never-block-publication discipline as Part 11 item 8, extended to this new post-publish step.
- **Manga-panel image generation**: using the `illustrator`-generated prompts, a new image-generation gateway call renders one or more manga-style panel images per chapter, stored in Supabase Storage and referenced from `chapters`. Opt-in per story (cost implications), triggered automatically post-publish when enabled or manually on demand for an already-published chapter.
- **Anime-style video generation**: a new, separate `videographer` model role and gateway drives an image-to-video (or text-to-video) generation call seeded by the chapter's manga panel(s) and prose, producing a short animated clip per chapter. Async by nature (video generation is slow) — modeled as a durable job (Inngest, matching the existing research-pipeline pattern) with a status the UI polls/subscribes to, never blocking publication or image generation. Opt-in per story, off by default given cost.
- **Full-text search**: search across a story's chapters (prose + summary) and entities (name + data), scoped to `story_members`, using Postgres full-text search (`tsvector`/`tsquery` + a GIN index) — no new infrastructure.
- **Export**: a story's chapters exportable as Markdown, PDF, and EPUB. Markdown is the base render; PDF and EPUB are generated from it. Available to any story member with read access to the exported chapters.
- **Public read-only share links**: a story owner/GM can mint a token-bearing link that renders published chapters read-only to an unauthenticated visitor, with no entity-sheet, submission, or state-mutation access. Revocable.
- **Universe marketplace**: browse and clone/fork universes where `universes.is_public = true` (column already exists, unused since Phase 2). Cloning creates a new `universes` row with `forked_from` set (column already exists) and copies `canon_bible`/`entity_schema`/etc. at the version cloned from — no shared mutable state between original and fork.
- **Mobile-responsive pass**: the existing turn loop, entity sheets, universe review UI, and story dashboard become usable at phone/tablet widths. No new routes or capabilities — a Tailwind breakpoint pass over existing components.
- **UI design pass**: real visual design (not default Tailwind/shadcn) across the same four surfaces, now that every phase's UI exists to design against. No new routes or capabilities — a styling/layout pass over existing components, done together with the mobile-responsive pass since both touch the same component tree.

## Capabilities

### New Capabilities
- `image-prompts`: the `illustrator` role, its prompt template, and the post-publish write path into `chapters.image_prompts`.
- `chapter-illustration`: manga-panel image generation from the illustrator prompts, storage, and per-story opt-in/cost controls.
- `chapter-video`: the `videographer` role, async video-generation job (Inngest), status tracking, and per-story opt-in/cost controls.
- `full-text-search`: search indexing and query surface across chapters and entities within a story.
- `story-export`: Markdown/PDF/EPUB generation from a story's published chapters.
- `share-links`: token-based public read-only access to a story's published chapters.
- `universe-marketplace`: public universe browsing and clone/fork.

### Modified Capabilities
- none — the mobile-responsive and UI design passes change presentation, not requirements, of the existing `turn-loop`, `entity-state`, `universe-review`, and `story-lifecycle` capabilities. No spec-level behavior changes.

## Non-goals

- No user-directed art/video editing (no in-app image editor, no manual video timeline/cut tool). Generation is one-shot from the chapter's content; a user can regenerate but not edit.
- No live/streaming video generation, no voice/audio/soundtrack generation, no multi-panel manga *pages* with layout/panel-composition logic — one or more independent panel images per chapter, not a composited page.
- No semantic/embedding-based search. Phase 4's `chapters.embedding`/`arc_summaries.embedding` already exist for context-assembly retrieval; full-text search here is a separate, user-facing keyword search surface using Postgres `tsvector`, not a reuse of the memory pipeline.
- No editing through a share link, no share-link comments/reactions, no share-link analytics beyond basic revocation.
- No marketplace ratings, reviews, monetization, or moderation queue — browse and clone only.
- No new turn modes, progression models, or research-pipeline stages — those are Phases 3, 2, and 7 respectively and are done.
- No conditional branching on genre, universe, or media type anywhere in this phase's code — export, search, and image-prompt generation all operate on generic story/chapter/entity structures, never on universe-specific content.
- No redesign of the data model beyond what's needed for search indexes, export jobs, and share tokens — `chapters.image_prompts` and `universes.is_public`/`forked_from` already exist and are unused; this phase is largely activating existing schema, not adding new core tables.

## Impact

- **Schema**: migrations for a search index (generated `tsvector` columns + GIN indexes on `chapters` and `entities`), a `share_links` table (token, story_id, created_by, revoked_at), an `export_jobs` table if export generation needs to run async for PDF/EPUB (confirm in design), `chapter_images` (chapter_id, storage_path, prompt, status, created_at) and `chapter_videos` (chapter_id, storage_path, status, job_id, created_at) for generated media, and per-story opt-in flags for illustration/video (likely additions to `stories.turn_config` or a new `stories.media_config jsonb`, confirmed in design). RLS on every new table, gated through `story_members` except `share_links`' public read path, which is scoped to the token itself, not session-based membership.
- **Code**: new `apps/web/src/lib/engine/image-prompts.ts` (illustrator role + post-publish hook alongside the existing extraction-worker pattern), `chapter-illustration.ts` (image-gen gateway call + storage), `chapter-video.ts` (Inngest job + videographer role), `search.ts`, `export.ts`, `share-links.ts`, `marketplace.ts`; `apps/web/src/lib/ai/roles.ts` gains `illustrator` and `videographer` to `MODEL_ROLES`/`DEFAULT_MODELS`; `apps/web/src/lib/ai/gateway.ts` gains image-generation and video-generation call functions alongside the existing chat/embeddings ones; new routes under `apps/web/src/app/stories/[storyId]/` for search/export/share/media, and a new `apps/web/src/app/universes/marketplace/` (or similar) route; a Tailwind responsive + visual-design pass across existing turn-loop, entity-sheet, universe-review, and dashboard components.
- **Model roles**: new `illustrator` and `videographer` roles added to the role table (Part 1.3 gains two rows), resolved via `resolveModel('illustrator'|'videographer', story.model_config)` exactly like every other role, each with a `usage_log` row per call (video jobs log at job completion, including failed-after-billed per Part 8.4/8's requirement 8).
- **Cost controls**: image and video generation are materially more expensive than text roles — per Part 8.3's spend-cap requirement, both are opt-in per story and subject to the same per-story/per-user spend caps as everything else, surfaced in the running-cost UI.
- **Docs**: new `docs/docs/phases/phase-8-polish.md`, architecture docs for search/export/share/marketplace/media-generation, sidebar and build-order/data-model reference updates — this phase closes out Part 10's build order, so `docs/docs/phases/build-order.md` moves from "in progress" to fully implemented.
