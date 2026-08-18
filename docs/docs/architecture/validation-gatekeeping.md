---
sidebar_position: 6
title: Validation & Gatekeeping
---

# Validation & Gatekeeping

Two distinct mechanisms, often confused:

- **Validation** audits a *generated chapter* for rule violations. It runs every turn.
- **The Gatekeeper** rules on a *player proposal* for something new. It runs when someone asks for a capability, alliance, or plot development they do not yet have.

## Validation rules

```json
{
  "id": "capability_gating",
  "source": "engine|research|user",
  "applies_when": {"progression_model_in": ["ability_unlock", "skill_tree"]},
  "check": "Any capability used must exist on the entity with status
            'available' or 'mastered'. Flag any usage of a capability
            with status 'proposed', 'developing', 'lost', or absent.",
  "severity": "block"
}
```

### Severity levels

| Severity | Behavior |
|---|---|
| `block` | Regenerate the chapter with the violation in the prompt. Max 2 retries, then escalate to the GM. |
| `warn` | Publish, but flag visibly. The GM can dismiss or revise. |
| `log` | Record silently for the consistency report. |

The retry cap matters. A model that fails validation twice usually fails it persistently; looping burns money and stalls the story. Escalating to a human is the correct third move.

## The standard rule pack

Engine-provided, applied to every universe unless explicitly disabled:

- Dead or incapacitated entities cannot act
- Entities cannot be in two locations simultaneously
- Destroyed items and locations remain destroyed
- Capability gating, when a progression model is active
- Established canon facts are not contradicted
- Player-submitted intent was actually addressed

That last rule is easy to overlook and matters enormously in multiplayer — a chapter that ignores one player's submission is a bug even when it breaks no world rule.

## Research-derived rules

Stage 7 of the research pipeline generates universe-specific rules:

- **Shonen:** "Power increases require a narrative cause — training, stakes, or emotional trigger. Flag unexplained escalation."
- **Mystery:** "No character may act on information they have not been shown to receive."
- **Hard sci-fi:** "No faster-than-light communication. Flag any instantaneous coordination across distance."
- **Comedy:** "Tone should not become sustained grimdark. Flag if three consecutive chapters contain no levity."

:::warning Tone rules are not decoration
The most common failure in long AI stories is not a rules violation — it is **genre drift**. A comedy becoming grimdark is a bug, and tone rules are how it gets caught.
:::

## The Gatekeeper

Runs when a player proposes something new.

**Input:** universe rules + progression model + entity's current state + the proposal

**Output:**

```json
{
  "verdict": "allow|allow_with_limits|reject",
  "reasoning": "In-universe explanation",
  "imposed_limits": ["..."],
  "suggested_alternative": "...",
  "narrative_cost": "What this should cost them"
}
```

This is the feature that keeps long campaigns coherent, and the one that makes the AI feel like a real GM rather than a yes-machine. Prompt quality here is worth real investment — it is also why the Gatekeeper role gets a reasoning-capable model rather than the cheap one.

:::tip Favor limits over rejection
A cost that makes the story better beats a flat no. `allow_with_limits` should be the most common verdict. But the Gatekeeper must not let players quietly power-creep past the universe's established ceiling — being told no is better than a story that stops making sense.
:::

## GM override writes to canon

Every flag needs one-click approval that **writes an exception into canon**, so it never re-flags.

Intentional rule-breaking is a legitimate creative choice. The system must support it without friction — and must *remember* it. An override that does not persist means fighting the same battle every chapter, which trains users to ignore the validator entirely.

```sql
create table canon_exceptions (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  rule_id text not null,
  exception_note text not null,
  created_by uuid references auth.users,
  created_at timestamptz default now()
);
```

The validator receives these exceptions in its prompt under an explicit "do not flag these" heading.

## Phase placement

Both mechanisms arrive in [Phase 6](/phases/build-order#phase-6--validation--gatekeeping). Phase 1 runs the loop with steps 5 and 6 absent — deliberately, so the loop's shape is proven before the audit layer is added on top of it.
