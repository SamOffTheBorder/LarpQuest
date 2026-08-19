---
sidebar_position: 13
title: Media Generation
---

# Media Generation

Phase 8 adds three per-chapter media steps, layered on top of the existing publish → extract → summarize sequence, none of them able to block or delay publication:

1. **Image prompt generation** — `illustrator` role writes 1–3 text prompts describing the chapter's key visual moment(s), written to `chapters.image_prompts`.
2. **Chapter illustration** — manga-style panel images rendered from those prompts, one per prompt, stored in Supabase Storage.
3. **Chapter video** — one anime-style clip per chapter, seeded from its illustration, rendered asynchronously via Inngest.

All three are opt-in per story. Video defaults off given its cost and generation time; illustration also defaults off, since it depends on prompts existing first.

## Why a separate gateway

`gateway.ts` — the one path to OpenRouter since Phase 1 — is built around the chat-completions contract: messages in, JSON or text out, token-priced usage. Image and video generation don't fit that shape: they return binary/URL output, video generation is a multi-minute async job rather than a request/response, and cost is priced per-asset or per-second, not per-token.

`media-gateway.ts` is the parallel path for these two calls, `generateImage` and `generateVideo`. It keeps the same contract every other role follows — resolve the model from the role via `resolveModel`, write a `usage_log` row on every attempt including failures — but doesn't try to force a token-shaped usage record onto a non-token cost.

## The one role that isn't OpenRouter

Every model role before Phase 8 routes through OpenRouter. `illustrator` keeps that pattern — OpenRouter serves image-output models through the same chat-completions endpoint, just with `modalities: ['image', 'text']` and an image payload in the response.

`videographer` is the exception. No current-generation video model is available through OpenRouter, so `generateVideo` calls a direct provider API instead. This is deliberately isolated: every call site still only ever sees `resolveModel('videographer', config)` and a `generateVideo(...)` function — if OpenRouter adds video support later, the swap happens entirely inside `media-gateway.ts`, with no call-site change.

## Queued vs. durable: why illustration and video are built differently

Image generation takes seconds. It reuses the same shape `extraction_queue`/`memory_queue` already established in Phase 1: a small claimable table (`image_prompt_queue` for prompts; `chapter_images` rows themselves carry illustration's per-image status), a `claim_*_job` SQL function with `skip locked` and stale-claim recovery, picked up by a worker that never touches the chapter or blocks anything ahead of it.

Video generation takes minutes, sometimes with the provider itself running an async job. That doesn't fit a queued-task-per-invocation model well — it needs the same kind of durable, resumable orchestration the research pipeline (Phase 3) already established Inngest for. `generate-chapter-video.ts` is an Inngest function with three steps (`mark-running`, `generate-video`, `upload-and-complete`, plus a `mark-failed` step in its catch path), each independently retried and memoized by Inngest.

```
chapter published
      │
      ▼
image_prompt_queue row inserted (by publish_chapter itself)
      │
      ▼
illustrator generates prompts ──► chapters.image_prompts written
      │
      ▼ (if illustration enabled)
chapter_images row(s) queued, generated inline
      │
      ▼ (if video enabled AND an image is complete)
chapter/video.requested event sent
      │
      ▼
generate-chapter-video (Inngest): queued → running → complete | failed
```

Nothing in this chain can retroactively affect an earlier step. A failed video job never touches the chapter's images; a failed image never touches the chapter's prompts; a failed prompt generation never touches the chapter itself. Each step's failure is visible only on its own row.

## Opt-in flags

Illustration and video are independent boolean flags at `stories.turn_config.media.{illustration,video}` — the same jsonb-key pattern Phase 7 used for `turn_config.active_mode`, rather than new dedicated columns on `stories`. They're independent on purpose: a story can enable illustration without video (the common case, given video's cost), but never the reverse in practice, since video generation requires a completed image to seed from.

The video flag is a per-story preference, not a deployment capability check — a story can have video enabled on a deployment that never provisioned `VIDEO_PROVIDER_API_KEY`. `requestChapterVideo`/`retryChapterVideo` check for that explicitly and fail with a clear "not configured on this deployment" error rather than letting a job dispatch and fail later with an opaque provider-auth error.

## Storage

Two private Storage buckets, `chapter-images` and `chapter-videos` (plus `story-exports` for the [export capability](/architecture/search-export-sharing)) — the first use of Supabase Storage in this project. Objects are keyed `story_id/chapter_id/...`, and a `storage.objects` policy checks `is_story_member` against the first path segment, mirroring how every table's RLS already gates on `story_members`. Only the service role writes; a member reads directly through the bucket policy, and a [share-link visitor](/architecture/search-export-sharing#share-links) reads through a short-expiry signed URL instead, since they aren't a `story_members` row at all.
