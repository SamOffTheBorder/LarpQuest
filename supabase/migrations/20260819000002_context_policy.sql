-- Phase 4: per-universe-version context policy and compressed canon bible.
--
-- context_policy lives on universe_versions, not universes, for the same
-- reason entity_schema does: a story pins a version, and its context
-- behavior should be pinned with it rather than silently changing when the
-- universe publishes a new version.
--
-- canon_bible_summary/canon_bible_rules_only are nullable and populated
-- synchronously by publish_universe_version going forward (see the app-level
-- change to that call site) — versions published before this migration keep
-- them null, which is only reachable by a story whose policy requests
-- canon_compression: 'full', a mode that needs neither column.

alter table universe_versions
  add column context_policy jsonb not null default (
    '{
      "recent_chapters": 3,
      "retrieved_chapters": 5,
      "retrieval_bias": "precedent",
      "canon_compression": "full",
      "token_budget": 24000
    }'::jsonb
  ),
  add column canon_bible_summary jsonb,
  add column canon_bible_rules_only jsonb;
