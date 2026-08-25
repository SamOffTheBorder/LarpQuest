# GM Entry Point — Naruto LARP

Read this file first in any fresh chat that will run or discuss this campaign. It tells you what to load, what's settled, what's scheduled but not yet written, and what you must not assume.

## What This Campaign Is

A tabletop-style Naruto campaign, run against the rules in `UNIVERSAL_STORY_GM_PROMPT.md` (one directory up, shared across all campaigns in this project — see `BlackCloverLarp/` for another running example of the same system). An **original genin team** — not an insert into canon Team 7 — navigates the Naruto world on its own arcs. Canon characters (Kakashi, the other Konoha 12, the Akatsuki, etc.) exist in the background and can be encountered, but this team runs its own missions, rivalries, and story separate from canon's main plot. Canon events can still happen on their own schedule in the wider world; they are not guaranteed to resolve the same way, and this team is not guaranteed to be present for or relevant to them.

**Player characters:** not yet created. See "What's Missing" below — this folder is currently a scaffold, set up to match the structure and conventions of `BlackCloverLarp/`, waiting on character details.

The raw play transcript will live in `OGFile.md` once play begins (immutable once chapters are written — append only, corrections go through the GM-override / `dead-canon.md` process, same as BlackCloverLarp). Everything in this folder should be derived from that file, with line citations back to source, once it exists.

## Load Order

1. **This file** — orientation.
2. `rules/universe.md`, `rules/progression.md`, `rules/house-rules.md` — the fixed backdrop and standing GM instructions.
3. `entities/characters/*.md` — the player characters: identity, quick-reference (fighting style, voice, tells), full jutsu/ability tables, gear, relationships, current state.
4. `entities/npcs/*.md`, `entities/factions.md`, `entities/locations.md` — supporting cast and world.
5. `chapters/state-at-0.md` (or whatever the current state file is) — the authoritative current-state snapshot and prioritized open-thread list.
6. `canon-exceptions.md` — deliberate, ratified departures from Naruto source canon, once any exist.
7. `audit/inconsistencies.md` and `audit/dead-canon.md` — the decision trail for anything flagged as contested or requiring a retcon.
8. `chapters/index.md` — line-range map into `OGFile.md`, for checking source text directly instead of trusting a summary.
9. `entity-history.md` — the append-only ledger of every state change across the campaign.

## Non-Negotiables

- **`OGFile.md` is never edited once a chapter is written.** It's the source record. Corrections live in `audit/dead-canon.md` and `entity-history.md`, pointing at it.
- **Rulings are final; don't re-litigate them.** If a new chapter touches something already ruled on in `audit/inconsistencies.md` or `canon-exceptions.md`, follow the ruling as written rather than treating it as still open.
- **State changes get logged.** Any new chapter's outcomes produce new rows in `entity-history.md` and, where relevant, updates to the relevant `entities/characters/*.md` file and the current `chapters/state-at-N.md` file (kept current as the single "state" pointer as the story advances, with a fresh numbered file superseding the last after each chapter or arc beat).
- **Options at the end of every chapter, no exceptions.** Every chapter ends with a numbered list of 2–4 concrete options per player character — never an open-ended "what do you do?" Full format and rules: `rules/house-rules.md` § "Options at the End of Every Chapter."
- **Combat prompts are always accepted.** Inside any fight, the player can direct how a character fights — stance, sequence, target priority, a specific exchange, a cross-character combo, or an explicit restriction — at whatever granularity they want. Every combat prompt still goes through the Reality Check rule first. Full detail: `rules/house-rules.md` § "Combat Prompts."

## What's Missing (do this before writing Chapter 1)

- **Player characters.** Village affiliation, clan (if any), jutsu/chakra-nature concept, personality triad, appearance (sex/race/skin/hair — required fields per house rules), backstory. One file per PC in `entities/characters/`.
- **The jonin sensei** and the team's formal genin-team identity (a number, like Team 7/Team 8/Team 10, or a custom designation).
- **Starting village and starting point** — see `rules/universe.md` for the placeholder timeline anchor; needs to be pinned to an actual point in Naruto's canon timeline (pre-Chunin Exams, post-Chunin Exams, post-Sasuke-defects, post-timeskip, post-war, etc.) before play begins, since that determines which canon characters/events are live, dormant, or already resolved.
- **`chapters/state-at-0.md`** — a "session zero" snapshot, once the above exists.

## Current State At A Glance

**Nothing has been played yet.** This is a fresh scaffold, structurally complete and ready for character creation and a first chapter.
