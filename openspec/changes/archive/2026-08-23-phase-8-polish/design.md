## Context

Phase 7 closed out the engine's turn-loop feature set. Everything in this phase is additive on top of a stable core: `chapters`, `entities`, `universes`, `stories`, `story_members` and their RLS patterns are settled, and `resolveModel`/`callStructured`/`usage_log` (`gateway.ts`, `roles.ts`) are the established path for every model call. No existing table's shape changes; every new capability either activates unused Part 8.2 schema (`chapters.image_prompts`, `universes.is_public`/`forked_from`) or adds new tables following the same RLS-via-`story_members` pattern used throughout.

Two capabilities in this phase — `chapter-illustration` and `chapter-video` — go beyond `STORYFORGE_BUILD_PLAN.md`'s literal Phase 8 scope ("image prompt generation" only) at explicit user request: actual manga-panel image rendering and anime-style video rendering per chapter, not just text prompts. These are new kinds of model call (image generation, video generation) that OpenRouter's chat-completions/embeddings API does not serve, so they need a new gateway surface, not just a new role.

Nothing here is genre-specific: illustration and video generation render *this chapter's* prose/prompts, whatever the universe. "Manga-panel" and "anime-style" are fixed visual styles chosen for the product (like the app choosing Tailwind/shadcn), not a per-universe branch — every story gets the same rendering style regardless of whether its universe is a shonen action series or a courtroom drama. This is analogous to Phase 1's narrator having one prose voice; it does not violate the no-genre-conditionals rule because it is not conditioned on genre at all.

## Goals / Non-Goals

**Goals:**
- Activate `chapters.image_prompts` via a new `illustrator` role, running post-publish, never blocking publication.
- Render manga-style panel image(s) from those prompts via a new image-generation gateway call, stored in Supabase Storage, opt-in per story.
- Render an anime-style video clip per chapter via a new `videographer` role and an async Inngest job (video generation is slow — minutes, not seconds), opt-in per story, off by default.
- Full-text search over a story's chapters and entities using Postgres `tsvector`, no new infrastructure.
- Export a story's chapters to Markdown/PDF/EPUB.
- Public, revocable, read-only share links for a story's published chapters.
- Universe marketplace: browse `is_public` universes, clone/fork with independent copies.
- Mobile-responsive and real visual-design passes over the four main existing UI surfaces.

**Non-Goals:**
- No image/video editing UI, no manga page compositing (panels are independent images), no audio/voice generation, no live/streaming generation.
- No semantic search (Phase 4's embeddings already serve context assembly; this is a separate keyword-search surface).
- No marketplace ratings/monetization/moderation.
- No change to any Phase 1–7 table's existing columns or RLS.

## Decisions

**1. Image and video generation get a new gateway module, `media-gateway.ts`, separate from `gateway.ts`.**
`gateway.ts`'s `callStructured`/`streamNarration` are built around OpenRouter's chat-completions contract (messages in, JSON or text out, token-based usage). Image and video generation are a different shape entirely: request a generation job, poll or webhook for completion, receive binary/URL output, and usage is priced per-image or per-second-of-video rather than per-token. Reusing `callStructured`'s signature would force a token-shaped usage record onto a non-token cost, and reusing its retry-on-schema-failure logic makes no sense when the "schema" is a binary asset. `media-gateway.ts` still uses the same `UsageRecorder` interface and writes a `usage_log` row per call (cost expressed in `cost_usd`, `prompt_tokens`/`completion_tokens` recorded as 0 or a documented proxy — confirmed during implementation which OpenRouter or direct-provider fields are available), and still resolves its model via `resolveModel(role, config)` — the role-resolution and cost-recording contract is unchanged, only the transport differs.
*Alternative considered*: extend `callStructured` with a `mode: 'image' | 'video'` branch. Rejected — the request/response shapes diverge enough (binary output, async job polling for video) that a shared function would need type-unsafe branching internally, working against the "every model call declares a role and resolves its model" contract's spirit of one clear path per call shape.

**2. Illustration providers are still routed through OpenRouter where available; video generation calls a direct provider API.**
OpenRouter has begun serving some image-generation models under the same `/chat/completions`-adjacent contract (image-output models); default `illustrator` model is chosen from OpenRouter's catalog at implementation time (mirroring `roles.ts`'s existing "verified against live OpenRouter model availability" pattern for `DEFAULT_MODELS`). No current-generation video-generation model is available through OpenRouter, so `videographer` calls a direct provider API (e.g. a Kling/Runway/Luma-class image-to-video API — exact provider confirmed at implementation time against pricing and API stability, stored as a documented default, never hardcoded outside `roles.ts`'s default table). This is the one deliberate asymmetry in an otherwise "everything through OpenRouter" system, and it's isolated to `media-gateway.ts`'s video path — a future OpenRouter video offering can replace it without touching any call site, since call sites only see `resolveModel('videographer', config)` + a `generateVideo(...)` call.
*Alternative considered*: wait for OpenRouter video support rather than integrate a second provider now. Rejected — the user asked for anime-style video generation in this phase; deferring it contradicts that request. The separate-provider seam keeps the eventual OpenRouter migration cheap.

**3. Illustration is synchronous-ish (a `step.run` inside the existing post-publish flow); video is a dedicated async Inngest job with its own status.**
Image generation (seconds) fits inside the same "runs after publish, never blocks publish" pattern the extraction-worker already uses — a queued task picked up shortly after publish, same shape as `extraction_queue`. Video generation (minutes, sometimes with provider-side async job polling) is modeled as its own Inngest function (`generate-chapter-video.ts`, alongside the existing `run-research-pipeline.ts` pattern) with a `chapter_videos.status` the UI subscribes to via Supabase Realtime — consistent with how the research pipeline already streams long-running progress without holding open a Next.js request.
*Alternative considered*: one combined `chapter_media` job for prompts+image+video. Rejected — the three have different failure modes, different opt-in flags, and video's async nature would force image and prompt generation to wait on Inngest scheduling latency for no benefit; keeping them as three independently-retryable steps matches Part 11's "never block on a slower downstream step" spirit.

**4. Illustration/video are opt-in flags on `stories.turn_config`, not new top-level columns.**
`turn_config jsonb` already holds free-form per-story turn behavior (deadline, absent policy, conflict policy per Part 8.2, and `active_mode` since Phase 7). Adding `media: { illustration: boolean, video: boolean }` follows the same jsonb-merge pattern `mode-switching.ts` already uses for `active_mode`, rather than introducing two new nullable boolean columns on `stories`.
*Alternative considered*: a dedicated `stories.media_config` column. Rejected as unnecessary — the merge pattern is already proven and this is exactly the kind of "story-level toggle" `turn_config` exists for.

**5. `chapter_images` and `chapter_videos` are separate tables, not columns on `chapters`.**
A chapter can have zero, one, or several manga panels (Non-goal: no page compositing, so each panel is its own row/asset) and at most one in-flight (later, possibly regenerated) video. Modeling both as jsonb columns on `chapters` would work for a single value but not a variable-length panel list with individual status/storage-path/retry state; separate tables also let a failed or regenerating image/video carry its own row without touching the immutable-ish `chapters` row (`chapters` already never gets rewritten once published, per the disposable-prose/permanent-state thesis — media rows are a better fit for retryable, evolving generation status).

**6. Storage: Supabase Storage, one bucket per media kind (`chapter-images`, `chapter-videos`), path keyed `story_id/chapter_id/...` so bucket-level RLS-equivalent policies can gate by story membership using Supabase Storage's policy-on-path support.**
This is the first use of Supabase Storage in the project. Storage policies mirror `story_members` gating the same way table RLS does elsewhere — a member can read a story's media, only the generation job (service role) writes it. Public share links (`share-links` capability) need a separate, narrower read path: signed URLs with a short expiry generated on demand by the share-link route, never a public bucket, so revoking a share link actually revokes access rather than leaving a previously-shared URL live forever.

**7. Full-text search uses generated `tsvector` columns + GIN indexes directly on `chapters`/`entities`, queried via a Postgres function callable through Supabase's RPC, not a new search service.**
Matches config.yaml's tech stack (no new infra beyond Postgres/Supabase) and Phase 4's own precedent of using pgvector directly rather than an external vector DB. A `search_story(story_id, query)` SQL function scoped by the caller's membership (checked the same way `is_story_member` is used elsewhere) keeps the RLS story intact without needing to duplicate membership logic in the app layer for a raw `tsquery` call.

**8. Export renders Markdown first; PDF/EPUB are generated from the Markdown, not from three independent renderers.**
Markdown is the natural source-of-truth render (chapters are already prose+structure); PDF is generated via a headless conversion (e.g. Puppeteer-free approach preferred given no Docker/Chrome-in-CI constraints noted in CLAUDE.md — a pure-JS Markdown-to-PDF library evaluated at implementation time) and EPUB via a pure-JS EPUB packer. Because PDF/EPUB generation can be slow for a long story, export runs as an `export_jobs` row + background step (same queued-task shape as extraction/illustration) rather than a synchronous request, with the finished file placed in Storage and a signed download URL returned when ready.

**9. Share links are a bare `share_links` table (token, story_id, created_by, revoked_at), not a join to entities/turns.**
A share link exposes exactly "this story's published chapters, read-only" — Non-goals rule out anything richer. The public route validates the token, loads the story's published chapters bypassing normal session-based RLS via a narrowly-scoped service-role read (mirroring how `invites.ts`'s token-based accept flow already works around normal membership-gated RLS for a pre-membership actor), and renders without any entity-sheet or submission UI. No RLS `select` policy exists for anonymous users on `chapters` directly — token validation happens in the route/server action, not at the RLS layer, exactly like the existing invite-accept flow.

**10. Marketplace clone is a deep copy at the pinned/latest version, not a reference.**
Cloning a `universes` row copies `canon_bible`/`entity_schema`/`progression_models`/`validation_rules`/`context_policy`/`turn_modes` into a new row with `forked_from` set and `version` reset to 1 — matching Phase 2's "universe versioning" precedent where a story pins a version and edits to the original never retroactively affect it. A fork is fully independent from the moment it's created.

## Risks / Trade-offs

- **[Risk] Image/video generation cost is unpredictable and the biggest bill risk in the product so far.** → Mitigation: both opt-in per story (video off by default), both subject to the same per-story/per-user spend caps as every other role (Part 8.3), both surfaced in the running-cost UI, and both write `usage_log` on failure-after-billed exactly like text roles.
- **[Risk] Video generation provider APIs are less mature/stable than OpenRouter's chat API — higher chance of an implementation-time provider swap.** → Mitigation: isolated entirely behind `media-gateway.ts`'s `generateVideo` function and the `videographer` role/default-model entry; no call site depends on provider specifics.
- **[Risk] Long-running video jobs can fail after partial provider-side billing.** → Mitigation: `chapter_videos.status` includes a `failed` state with the job retryable independent of the chapter (chapter publication and image generation are already complete by the time video runs), and `usage_log` records the attempt regardless of outcome, matching Part 11 item 8's spirit extended to media.
- **[Risk] Introducing Supabase Storage for the first time is new operational surface (bucket policies, signed URL expiry tuning).** → Mitigation: two buckets only, path convention fixed up front (`story_id/chapter_id/...`), signed-URL pattern reused identically for share-link chapter media and story export downloads rather than inventing a second access pattern.
- **[Risk] `tsvector` full-text search on long chapter prose has no relevance tuning (stemming/ranking) beyond Postgres defaults.** → Mitigation: acceptable for a keyword-search feature per the proposal's non-goal on semantic search; `ts_rank` ordering is a reasonable default and can be revisited without a schema change (GIN index survives a ranking-function change).
- **[Risk] Mobile-responsive + UI design pass touches nearly every existing component, high regression surface for a non-behavioral change.** → Mitigation: no capability/requirement changes accompany it (per proposal's "Modified Capabilities: none"), so existing tests are the regression guard; done as its own task-tracked sweep at the end of the phase after every other capability's UI exists, per the build plan's own framing ("once every phase's surface area exists to design against").

## Migration Plan

1. `..._chapter_media.sql`: `chapter_images`, `chapter_videos` tables + RLS gated through `story_members` (via the chapter's story), Storage buckets `chapter-images`/`chapter-videos` + path-based storage policies.
2. `..._search_indexes.sql`: generated `tsvector` columns + GIN indexes on `chapters`, `entities`; `search_story(story_id, query)` function.
3. `..._share_links.sql`: `share_links` table + RLS (owner/GM manage; token-based public read handled at the route layer, not RLS).
4. `..._export_jobs.sql`: `export_jobs` table + RLS gated through `story_members`; Storage bucket `story-exports`.
5. `roles.ts`: add `illustrator`, `videographer` to `MODEL_ROLES`/`DEFAULT_MODELS`.
6. `media-gateway.ts`: `generateImage`, `generateVideo`, both role-resolved, both `usage_log`-recording.
7. `image-prompts.ts`, `chapter-illustration.ts`, `chapter-video.ts` (+ Inngest function), `search.ts`, `export.ts` (+ Inngest function), `share-links.ts`, `marketplace.ts`.
8. UI routes for search/export/share/media/marketplace; mobile-responsive + design pass last, once the above surfaces exist.
9. No changes to existing tables/columns — fully additive. Rollback per capability: drop the relevant new table(s)/bucket(s); no Phase 1–7 table is touched, so rollback of any one Phase 8 capability has zero blast radius on the others or on prior phases.

## Open Questions

- Exact `illustrator` and `videographer` default models/providers, confirmed against live availability and pricing at implementation time (same verification discipline `roles.ts` already documents for its existing defaults).
- Whether OpenRouter's image-output support is stable enough to route `illustrator` through it at implementation time, or whether it also needs a direct-provider fallback like `videographer`.
- Exact PDF/EPUB generation libraries, chosen at implementation time against the no-Docker/no-headless-Chrome constraint.
