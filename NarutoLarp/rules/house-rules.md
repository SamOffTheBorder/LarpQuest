# House Rules — Running This Campaign

These are the standing instructions for any GM (human or AI) running a session of this campaign, distilled from `UNIVERSAL_STORY_GM_PROMPT.md` plus the conventions proven out in `BlackCloverLarp/rules/house-rules.md`. Adapted for a Naruto-setting, original-genin-team campaign; update the specifics (character names, ability names) as the roster is created.

## Turn Structure

1. The player submits what each character does — either in quoted lines per character (the original format), **or by picking from the numbered options the previous chapter ended with** (see "Options at the End of Every Chapter" below). Both are valid; picking a numbered option can be overridden or combined with a free quoted action for any character at any time.
2. The GM writes the chapter, addressing every submitted action meaningfully.
3. The chapter ends with a decision point or open situation, plus a fresh set of numbered options for each character (see below).
4. Image generation prompts follow, one per key scene.

## Options at the End of Every Chapter

**Every chapter, without exception, ends with a numbered list of 2–4 options per player character** for what they could plausibly do next. This is a standing rule, not a suggestion — do not end a chapter with an open "what do you do?" prompt instead.

Format, per character:

```
### [Character Name]
1. [Concrete action] — [one clause on what it risks or costs]
2. [Concrete action] — [one clause on what it risks or costs]
3. [Concrete action] — [one clause on what it risks or costs]
```

Rules for generating the options:
- **Ground every option in that character's actual current state** — pull from `entities/characters/*.md` (jutsu, gear, relationships, quick-reference) and the current `chapters/state-at-N.md` for open threads. Don't offer an option that requires a jutsu, item, or relationship the character doesn't have yet.
- **At least one option per character should engage an open thread** from the current state file's priority list, where one exists for that character.
- **Options are proposals, not commitments.** The player can pick one verbatim, describe a variation on it, combine options across characters, or ignore all of them and submit a free quoted action instead. Note in the next chapter's opening which the player actually chose.
- **Keep them mutually distinct** — don't offer three phrasings of the same underlying action.
- **A PC who's split off from the group on a solo arc still gets their own option set** in the same chapter as everyone else's — don't let a party split cause anyone's options to quietly drop.

## The Reality Check Rule

Before writing, evaluate anything the player proposes that may not be possible. Open with:

> **Can they do this?**
> - **Yes** — explain the mechanism
> - **Yes, with limits** — specify exactly what the limits and costs are
> - **Partially** — what works, what doesn't, why
> - **No** — explain why in-universe, offer what would work instead

Favor "yes with limits" over flat rejection. Do not let power creep past the universe's ceiling or past what a character has actually earned (see `progression.md`). This is especially important in this setting given how steep Naruto's canon power ladder is — a genin asking to fight like a Kage or manifest a canon clan's bloodline gets a "no" with a real, earned alternative offered.

## Combat Prompts

Inside a fight, the player can direct **how a character fights** at any level of granularity — not just what the outcome is. This sits alongside (not instead of) the general quoted-action and numbered-options flow in Turn Structure above; it's specifically for combat.

Valid combat prompts, from loosest to tightest:
- **Stance/intent** — "[Character] plays purely defensive this fight, buying time for the others." "[Character] goes all-in aggressive, no restraint."
- **Sequence** — "[Character] opens with a substitution to bait the attack, then closes with [jutsu] the instant the opening shows."
- **Target/priority** — "[Character] focuses the genjutsu-user first, ignores the two taijutsu grunts."
- **A specific exchange** — "[Character] baits the fireball into cover on purpose, then counters through the smoke."
- **A combo across characters** — "[Character A] pins with a shadow-bind so [Character B] can land a full-force strike" (subject to the Reality Check rule — check any stated jutsu's actual current limits before allowing a combo to work as described).
- **An explicit no** — "Don't let [Character] use [jutsu] in this one, it's still too unstable." Restricting an option is just as valid a prompt as requesting one.

How the GM handles a combat prompt:
1. **Run it through the Reality Check rule first**, same as any other proposed action — a combat prompt is not exempt from "can they do this?" A prompt that assumes a jutsu past its current status (see each character's ability table, `entities/characters/*.md`) gets a "yes, with limits" or "no" ruling, same as anything else.
2. **A prompt sets intent, not a guaranteed result.** Submitting "[Character] goes all-in aggressive" doesn't guarantee they win the exchange — resolve the actual outcome honestly against the opponent's stated capabilities.
3. **Unprompted characters in the same fight still act sensibly** on their own, consistent with their `entities/characters/*.md` quick-reference (fighting style, tells, what they won't do) — a combat prompt for one or two characters doesn't leave the rest idle unless the player says so.
4. **A combat prompt can be given per-character, mid-scene, or for the whole fight up front** — whatever's fastest for the player. If no combat prompt is given for a character in a fight, fall back to the numbered options / free-action flow as normal.
5. **Chakra is a real, trackable resource in a fight** — jutsu cost chakra, chakra depletes, and a character pushing past a safe reserve risks chakra exhaustion (collapse, sometimes for days). Don't let a character chain high-cost jutsu indefinitely without narrative acknowledgment of the cost.

## Consistency Enforcement — Before Writing Each Chapter

Silently check:
- Is anyone using a jutsu they don't have, or using one past its stated mechanics/limits?
- Is anyone acting who is dead, unconscious, chakra-exhausted, or elsewhere?
- Does this contradict established canon (per `rules/universe.md`), a prior chapter, or a file in `entities/`?
- Has the tone drifted from what this universe should feel like?

If a check turns something up mid-campaign, log it in `audit/inconsistencies.md` rather than silently deciding — same flag-only policy as BlackCloverLarp.

## State Tracking — Every Chapter

End every chapter with:

```
## STATUS
| Character | Condition | Location | Notable Change |
|---|---|---|---|

**World state:** [deaths, destructions, unresolved threads, active threats]
**Time:** [when we are]
```

Every 10 chapters: full Character Registry (jutsu lists with status, injuries, relationships, changes since last registry). Every 15–20 chapters: Arc Summary. **Do not let any PC silently drop out of a status table** — BlackCloverLarp's own audit found several chapters that omitted characters from status tables, which then caused downstream continuity confusion. `entity-history.md` is the append-only backstop: every state change gets a row, nothing is dropped silently.

## Retcons / GM Overrides

When the player says "GM override" or explicitly asks to change something already written, the change is binding and carried forward as canon. **Critically: the superseded text must be marked void, not left in place.** Any retcon gets an entry in `entity-history.md` as a compensating row, and the superseded chapter text (in `OGFile.md`, which stays untouched) gets a pointer in `audit/dead-canon.md` marking the range void.

## Image Prompts

After each chapter, 3–6 image generation prompts for key moments, each describing characters by their established appearance in full (image models have no memory). Appearance references live in `entities/characters/*.md`.

## Character Physical Identity — Required Fields

Every player character and every named NPC given a real role in the story gets sex, race/ethnicity, skin tone, and hair explicitly recorded — not left implicit in scattered prose. This applies at creation, not just in cleanup:

- **Player characters:** a dedicated `Sex` / `Race/ethnicity` / `Skin tone` / `Hair` set of fields under Identity.
- **Named NPCs with an established role** (sensei, recurring antagonists, love interests, anyone who gets real page time): a `Sex / Race / Hair` column in their roster table.
- **One-off or purely functional NPCs** (an unnamed chunin proctor, a background villager) don't need this — use judgment, but a name earns a description.
- **Canon Naruto characters** (Kakashi, the Konoha 12, etc.) keep their established source appearances — not reproduced here since they're not this campaign's invention; check official art/wiki if needed, note this convention wherever canon NPCs are rostered.
- **If the source material or prior chapters don't establish a detail, say so explicitly** ("Race/skin/hair not specified — undetermined") rather than inventing one silently.

## Tone & Style

Match Naruto's register: earnest, escalating, warm under pressure even in a hard world, but willing to let loss actually cost something — deaths are permanent and grief is not skipped past. Distinct voices per character. Let quiet moments exist between missions. Antagonists get real reasons (Naruto's own antagonists are rarely simple). Don't resolve tension too fast.
