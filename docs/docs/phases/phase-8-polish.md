---
sidebar_position: 9
title: Phase 8 — Polish
---

# Phase 8 — Polish

**Status:** Implemented (UI design pass and browser verification pending — see "What's left")
**Spec location:** `openspec/changes/phase-8-polish/`

Phase 8 is build plan Part 10's final phase. Phase 7 (Turn Modes) is implemented and archived, which means every other phase's UI surface now exists — the turn loop, entity sheets, universe review, and the story dashboard are all real screens with real data flowing through them. That's the precondition Part 10 names for this phase: cross-cutting, story-spanning features and a real design pass can now be built against a stable engine instead of a moving one.

`chapters.image_prompts jsonb` has sat unused since the schema was first created in Phase 1. `universes.is_public` and `universes.forked_from` have sat unused since Phase 2. This phase is the first to write to any of them.

**This phase's scope extends beyond the build plan's literal text.** Part 10 describes "image prompt generation" — text prompts only. At the project owner's explicit request, this phase also generates actual manga-style panel images and anime-style video clips per chapter, not just the prompts that describe them. Everywhere below, "image prompt generation" (text) is kept distinct from "chapter illustration" and "chapter video" (actual rendered media), because they have different cost profiles, different opt-in defaults, and different failure modes.

## What ships

- **Image prompt generation** — a new `illustrator` model role produces one or more image-generation prompts per published chapter, written to `chapters.image_prompts`. Runs after publication, never blocks it, exactly like extraction.
- **Chapter illustration** — manga-style panel images rendered from those prompts via a new image-generation gateway call, stored in Supabase Storage. Opt-in per story.
- **Chapter video** — anime-style video clips rendered from a chapter's image(s) and prose via a new `videographer` role and an async Inngest job. Opt-in per story, **off by default** given cost and generation time.
- **Full-text search** — keyword search across a story's chapters and entities using Postgres `tsvector`/`tsquery` and a GIN index. No new infrastructure.
- **Story export** — Markdown, PDF, and EPUB, generated inline (not a background job — see design decisions below) from a single Markdown render.
- **Public share links** — a token-bearing, revocable, read-only link to a story's published chapters, for an unauthenticated visitor.
- **Universe marketplace** — browse universes with `is_public = true`; clone/fork one into a fully independent copy.
- **Mobile-responsive and UI design passes** — over the turn loop, entity sheets, universe review, and story dashboard, plus every new surface this phase adds.

## What does not ship

Image/video editing tools, manga page compositing (panels are independent images, not a laid-out page), voice/audio/soundtrack generation, live/streaming video, semantic search (Phase 4's embeddings already serve context assembly — this is a separate keyword surface), marketplace ratings or monetization, and any new turn mode, progression model, or research-pipeline stage.

## Capabilities specified

| Capability | Covers |
|---|---|
| `image-prompts` | The `illustrator` role and the post-publish write path into `chapters.image_prompts` |
| `chapter-illustration` | Manga-panel image generation, storage, per-story opt-in |
| `chapter-video` | The `videographer` role, async video job, per-story opt-in (default off) |
| `full-text-search` | `tsvector` indexing and query surface across chapters and entities |
| `story-export` | Markdown/PDF/EPUB generation from a story's published chapters |
| `share-links` | Token-based public read-only access, with revocation |
| `universe-marketplace` | Public universe browsing and clone/fork |

No existing capability's requirements change — the responsive and design passes are presentation-only.

## Key design decisions

### A separate media gateway, not an extension of the chat gateway

`gateway.ts`'s `callStructured` is built around OpenRouter's chat-completions contract: messages in, JSON or text out, token-priced usage. Image and video generation are a different shape — binary/URL output, job-based async completion for video, usage priced per-image or per-second rather than per-token. A new `media-gateway.ts` keeps the same role-resolution and `usage_log` contract every other call follows, without forcing a token-shaped usage record onto a non-token cost.

### Video generation is the one call that doesn't go through OpenRouter

No current-generation video model is available through OpenRouter, so `videographer` calls a direct provider API. This is a deliberate, isolated exception — every call site still only sees `resolveModel('videographer', config)` and a `generateVideo(...)` function, so a future OpenRouter video offering is a swap inside `media-gateway.ts`, not a call-site change.

### Illustration is a queued task; video is a durable Inngest job

Image generation takes seconds and fits the same post-publish queued-task shape the extraction worker already uses. Video generation takes minutes and sometimes involves provider-side async polling — it gets its own Inngest function with an observable `chapter_videos.status`, the same pattern the research pipeline already uses for long-running, progress-tracked work.

### Neither illustration nor video can ever block publication, prompt generation, or each other

A chapter publishes the moment it's generated and validated, same as every phase before this one. Prompt generation, image generation, and video generation are three independently retryable steps layered on top — a failure in any one never touches the chapter or the steps before it.

### Storage access mirrors RLS, but share links break the pattern on purpose

Chapter images and videos live in Supabase Storage, gated by story membership the same way every table's RLS is. A share link, by definition, grants access to someone who isn't a member — so the public share route validates a token via a database function (`resolve_share_link`, `security definer`, granted to `anon`) and issues short-expiry (5-minute) signed URLs directly, the same way `invites.ts`'s pre-membership accept flow already works around session-based RLS for a user who isn't a member yet. Revocation stops the token from resolving and stops any *new* signed URL from being issued — it cannot invalidate a URL already handed to a visitor's browser, since a signed URL is a self-contained credential. The short TTL, not the revocation, is what bounds that exposure window.

### Export renders inline, not as an Inngest job

The original plan modeled export the same way as video — a durable background job. In practice, Markdown/PDF/EPUB generation is local CPU work with no external API call and no realistic multi-minute wait at any story length this app supports, so `requestExport` renders and uploads inline before returning. The `export_jobs` row still exists and carries the same queued/complete/failed status shape, so an async path remains a drop-in future option if export ever needs to scale past what inline generation can handle.

## Database objects

New this phase: `chapter_images`, `chapter_videos` (RLS via the owning chapter's `story_members`), `share_links` (owner/GM-managed; public reads handled at the route layer, not RLS), `export_jobs` (RLS via `story_members`). Generated `tsvector` columns and GIN indexes added to `chapters` and `entities`. New Storage buckets: `chapter-images`, `chapter-videos`, `story-exports`.

No existing table's columns change. `chapters.image_prompts`, `universes.is_public`, and `universes.forked_from` — present since Phase 1 and Phase 2 respectively — are populated for the first time.

→ [Full data model](/reference/data-model) · [Media Generation architecture](/architecture/media-generation) · [Search, Export & Sharing architecture](/architecture/search-export-sharing)

## What's left

The design pass proper — typography, color, and component styling beyond shadcn defaults — is deliberately not done. A mechanical mobile-responsive pass (Tailwind breakpoints, header stacking, text sizing) was applied across all five pre-existing pages plus the four new Phase 8 pages, and `npm run build` confirms all 24 routes compile and generate. What's missing is a human looking at any of it in an actual browser at actual widths — no browser was available while this phase was implemented, so section 10.4's manual verification pass and any real visual design work are still open.

## Verifying the phase

Per `openspec/changes/phase-8-polish/tasks.md`: role resolution and media-gateway usage recording (including a real image round-trip through `pdfkit`/`jszip` for export), illustration/video opt-in defaults and authorization, generation-never-blocks-publication for every media step, search scoping to story membership (verified under the session-bound client, since the underlying RPC reads `auth.uid()`), export in all three formats with correct access scoping, share-link revocation actually stopping resolution (with the signed-URL exposure-window caveat documented above), and marketplace clone producing a fully independent fork. No `phase-8-exit-criterion.test.ts` yet — see the change's `tasks.md` section 12 for what remains.

`npm test` (437/437), `npm run typecheck`, `npm run build` from `apps/web` all pass. `docs/`'s own `npm run build` passes with both new architecture pages linked. Migrations pushed to the linked Supabase project via `supabase db push --linked`; `supabase db advisors --linked` and the RLS coverage test both clean (advisors flag the newly-public `resolve_share_link`/`clone_universe`/`search_story` grants, which are intentional).

## Working the phase

```bash
openspec show phase-8-polish
openspec status --change phase-8-polish
openspec validate phase-8-polish --strict
```

→ [Spec workflow](/reference/spec-workflow)
