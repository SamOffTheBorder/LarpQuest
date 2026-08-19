---
sidebar_position: 14
title: Search, Export & Sharing
---

# Search, Export & Sharing

Three Phase 8 capabilities that take a story's content outside the in-app turn loop: keyword search across it, file export of it, and a public read-only view into it.

## Full-text search

A separate, user-facing keyword surface — it does not read or reuse the `chapters.embedding`/`arc_summaries.embedding` columns Phase 4 added for context-assembly retrieval. Those serve semantic similarity for the narrator's prompt; this serves "find the chapter where X happened" for a human.

Built entirely on Postgres: generated `search_vector tsvector` columns on `chapters` (summary weighted above prose) and `entities` (name weighted above `data`), each with a GIN index, and one `search_story(story_id, query)` function that ranks matches from both tables together with a `kind` discriminator.

`search_story` is `security definer` and checks `is_story_member` against the *caller's own session* — which means, unlike the extraction worker or `chapter-illustration.ts`, `search.ts` calls it through the session-bound client (`createClient()`), never the service-role client. A service-role call carries no user session, so `auth.uid()` inside the function would resolve to null and the membership check would always fail — the same reason `invites.ts`'s `joinViaInvite` uses the session-bound client for `join_story_via_invite`.

Search result snippets come from Postgres's `ts_headline`, which wraps matched terms in literal `<b>...</b>` around otherwise-unescaped chapter or entity text — text a player wrote, not something the search UI can trust as safe HTML. The search page parses that fixed delimiter and renders each span as plain React text (auto-escaped) with a real `<b>` element only around the matched portion, rather than using `dangerouslySetInnerHTML` on the raw snippet.

## Export

A story's chapters render to Markdown first — `renderStoryMarkdown` assembles non-rolled-back chapters in turn order into one document — and PDF/EPUB are generated *from* that same chapter data, not three independent renderers. PDF uses `pdfkit`, which draws text directly onto a PDF stream with no browser involved; EPUB uses `jszip` plus a small hand-built OPF manifest, since an EPUB file is structurally just a zip of XHTML documents. Both choices avoid a headless-Chrome dependency this environment doesn't have.

`requestExport` creates an `export_jobs` row and then renders inline, synchronously, rather than dispatching to Inngest. That's a deliberate deviation from the original plan: unlike video generation, Markdown/PDF/EPUB rendering is local CPU work with no external API call and no multi-minute wait at any story length this app supports, so a durable job would only add scheduling latency. The `export_jobs` row still gives every format the same queued/complete/failed status shape a future async path could adopt without a schema change.

## Share links

The one capability with no anonymous-read RLS policy anywhere. A share-link visitor is not a `story_members` row — by definition, they're not authenticated at all — so `resolve_share_link(token)` is the authorization boundary instead: `security definer`, granted to `anon`, returning a story id for a valid unrevoked token or null otherwise. This mirrors `join_story_via_invite`'s pre-membership pattern from Phase 5, where a token itself is the authorization for someone who isn't a member yet.

```
visitor opens /share/[token]
        │
        ▼
resolveShareLink(token) → resolve_share_link RPC
        │
   ┌────┴────┐
 null      story_id
   │          │
   ▼          ▼
notFound   getSharedStoryView(token)
              │
              ▼
     non-rolled-back chapters
     + signed URLs for complete images/videos
     (no entities, no submissions, no turn data)
```

`getSharedStoryView`'s return type, `SharedStoryView`, has no field for entity or submission data — the exclusion is structural, not a runtime filter that could be forgotten on some code path.

Media lookups are batched, not per-chapter: one `IN (...)` query against `chapter_images` and one against `chapter_videos` for the whole chapter-id list, and one `createSignedUrls` call per bucket rather than one `createSignedUrl` call per file. This is the one anonymous, public-facing route in the app — a 30-chapter story with media on every chapter would otherwise be well over a hundred sequential round-trips on a single page load.

### What revocation actually stops

Revoking a share link sets `revoked_at`, which does two things: `resolve_share_link` stops returning a story id for that token (so the page itself 404s), and no *new* signed media URL can be issued through it. What it cannot do is invalidate a signed URL already handed to a visitor's browser before the revocation — a signed URL is a self-contained bearer credential, not a lookup that re-checks the link's status on each use. That's why `getSharedStoryView` issues short-expiry (5-minute) signed URLs rather than long-lived ones: the expiry, not the revocation, is what bounds how long a previously-issued URL keeps working.

## Universe marketplace

Activates two columns (`is_public`, `forked_from`) that existed in the build plan's Part 8.2 schema sketch since Phase 1 but were never created — Phase 2's actual `universes` table is identity-only (`owner_id`, `name`), with all versioned content living on `universe_versions`. Phase 8's migration adds both columns, widens `universes_select`/`universe_versions_select` to allow `is_public` rows regardless of owner, and adds a `clone_universe(universe_id, owner_id)` function that reads the source's latest `universe_versions` row and calls the existing `create_universe_with_version` RPC — the same function Phase 2 uses for hand-authored universes and Phase 3 uses for published research drafts — to create the fork atomically, then sets `forked_from`.

A clone is a full copy at the moment of cloning, not a reference: editing the source afterward — through a new `universe_versions` row — never touches the fork, exactly like a story that pinned a version never sees a later edit to its source universe (Phase 2's versioning guarantee, extended here to forks).
