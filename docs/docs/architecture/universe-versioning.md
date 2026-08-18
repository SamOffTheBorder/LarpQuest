---
sidebar_position: 5
title: Universe Versioning
---

# Universe Versioning

:::info Implemented in Phase 2
See [Phase 2 — Universe System](/phases/phase-2-universe-system).
:::

A universe is a named, owned container for an [Entity Schema](/architecture/schema-system) and a progression model, versioned independently of any story. A story that opts into one pins a specific version and keeps it until its owner explicitly upgrades.

## Why versioning exists from Phase 2

A story pinned to a universe reads that universe's schema and progression model on every entity write. If editing a universe could change what an already-running story validates against, a canon correction made in chapter 41 could retroactively invalidate — or simply stop matching — chapters 1 through 40. Build plan Part 11.1 calls this out explicitly as something that will hurt if deferred: retrofitting version pinning after stories already exist means every one of them breaks the first time someone edits a universe.

## The shape

```
universes
  id, owner_id, name

universe_versions
  id, universe_id, version, entity_schema, progression_model, progression_config, published_at
  unique (universe_id, version)

stories
  ..., universe_id, universe_version   -- nullable; FK into (universe_id, version)
```

A universe's identity (`universes`) and its versioned content (`universe_versions`) are separate tables. `universes` never carries a schema or progression model directly — every meaningful piece of content lives in an immutable version row.

## Versions are immutable

`universe_versions` has no update or delete policy. The only way a row is created is through one of two security-definer RPCs:

- `create_universe_with_version` — creates a universe and its version 1 in one transaction
- `publish_universe_version` — appends version *n+1* to an existing universe, verifying the caller owns it

Neither ever touches an existing row. "Editing" a universe's schema, in the system's vocabulary, means calling `publish_universe_version` — there is no operation that mutates a published version in place.

:::tip Draft state arrives in Phase 3, above this layer
Phase 2 has no research pipeline and no human-review UI, so a universe's first version was published the moment it was created. [Phase 3](/phases/phase-3-research-pipeline) introduces `universe_drafts` — a review workflow that sits entirely *above* this immutable-version model: a draft accumulates and gets reviewed as ordinary `jsonb`, and only calls `createUniverse` once accepted. Nothing here changed to support it.
:::

## Stories pin, and only move on explicit request

A story's `universe_id` and `universe_version` are set once, at creation, to whatever the universe's latest published version is at that moment (`getLatestUniverseVersion`). After that:

- The universe publishing a new version does **not** move the story's pin. The story keeps reading its original version indefinitely.
- The only way the pin changes is `upgrade_story_universe_version`, called explicitly by the story's owner.
- Entity history is untouched by an upgrade — it only changes which schema and progression model govern *future* writes.

This is deliberate asymmetry: automatic follow-latest would reintroduce exactly the retroactive-break problem versioning exists to prevent.

## What has no universe

A story created without specifying one has `universe_id = null`, `universe_version = null` — permanently, not as a transitional state. Entity writes for such a story are never validated against a schema, exactly matching [Phase 1](/phases/phase-1-generic-core)'s behavior. This is the same design as the schema-validation boundary in [Schema System](/architecture/schema-system): opting in is additive, not a migration every story eventually takes.
