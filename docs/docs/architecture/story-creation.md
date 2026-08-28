---
sidebar_position: 21
title: Story Creation
---

# Story Creation

Before this existed, creating a story meant a title, a content rating, and then a blank turn 1. The blank page is the hardest moment in the product, and it was the moment we gave the least help.

Story creation is now two steps: describe what you want, then review what the system drafts.

```
intent  ──▶  generate  ──▶  review  ──▶  approve  ──▶  story
             (premise role)   │                        + world ledger
                              └── re-roll ◀──┘         + cast entities
```

## The shape is borrowed on purpose

This is the [universe review](/architecture/universe-review) loop at a smaller scale: a draft owned by one user, a sectioned document, per-section accept/edit/reject, re-run what you rejected, publish when satisfied. The premise document reuses the same `{ status, content, editedContent? }` section wrapper the research draft uses, so the two review surfaces do not drift apart.

The differences are all about size. A premise is **one** model call taking seconds, not eight staged calls over minutes — so it runs inline in a server action rather than through Inngest. Durable orchestration would buy nothing here: a failure is recoverable by pressing the button again, and the typed intent is already persisted, so nothing is retyped.

## Intent is open text, never a genre picker

The creation form has a primary freeform pitch plus optional guided fields — setting, tone, must-include, must-avoid, cast size — behind a disclosure.

Every one of those fields is **open text or a number**. There is deliberately no genre dropdown, no media-type selector, no tone enum.

:::danger Why there is no genre picker
A genre dropdown would put a genre vocabulary into a schema, and from there into prompts, database rows, and eventually a branch somewhere. That is exactly what [the core thesis](/architecture/core-thesis) forbids, and `genre-agnosticism.test.ts` scans engine code for precisely this.

The guidance comes from **what each field asks** and its placeholder, not from a menu of answers. A setting field placeholdered with "a vertical city in perpetual rain" guides as well as a dropdown, costs nothing in engine coupling, and does not cap the GM at the genres we happened to think of. Structure lives in the labels; freedom lives in the values.
:::

## Keeping what works

The premise arrives as six sections — pitch, setting, opening situation, cast, hooks, tone — each independently reviewable. The GM keeps what works, cuts what doesn't, optionally edits any section in their own words, and writes freeform notes to steer the next attempt.

Re-rolling then replaces **only** what was cut. Kept sections are preserved by two separate mechanisms:

1. **In the prompt** — settled sections are supplied as fixed constraints, so regenerated sections stay coherent with them. A new opening situation that ignored the kept cast would be useless.
2. **In the merge** — stored content wins unconditionally over whatever the model returns for a pinned section.

Both are needed. Prompting alone risks silent drift in a section the GM already approved; merging alone produces a premise whose parts contradict each other.

### The cast is cut member by member

Every other section is reviewed whole. The cast is a list of independent characters, and "I like two of these three" is the most likely single piece of feedback in the flow — so cutting the whole section to remove one character would throw away two good ones.

Cut members are retained rather than deleted, so a cut is reversible and so regeneration can see what was rejected instead of silently reproposing it.

## Approval seeds real state

Approving creates the story, writes the resolved premise (edits winning over generated text, cut sections omitted) to `stories.world_ledger.premise`, and creates each kept cast member as an entity.

Entities go through the normal `createEntity` path rather than a bulk insert, so each one writes its `entity_history` row and is validated against any pinned universe schema.

:::note Partial failure keeps the story
The story row exists before the entities do, so a cast member that fails schema validation cannot be undone by rolling back. When that happens the story and the successfully created entities are kept, and the failures are named so the GM can add those characters by hand.

Rolling back would be worse: it discards a valid story and a completed review over one fixable entity.
:::

## Generation is always optional

"Skip and start blank" creates a story from a title and rating alone, with no model call. A story created that way is indistinguishable from one created before any of this existed.

## Costs and limits

Premise generation happens before a story exists, which shapes three things:

- The `premise` role resolves through the role table's defaults — there is no story `model_config` to consult yet.
- Usage and spend are attributed to the **user**, not a story, so premise spend appears in account-level spending rather than any per-story cost view.
- The API key resolves from the user's own stored key, else the platform key. The GM → owner → platform order has no meaning when neither role exists.

Generation carries its own rate limit, separate from story creation, because it is a billed model call reachable before any story exists.

## Failure behavior

| Failure | Result |
|---|---|
| Transport failure or timeout | Draft untouched, error is retryable, intent preserved |
| Malformed model output | One retry with the error appended, then a typed error; draft stays in its prior state |
| Re-roll fails | The premise under review is left intact |
| First generation fails | The GM lands on the review page with a **Try again**, not an empty form |
| A cast member fails to seed | Story kept, failure named (see above) |

## Where the premise goes afterward

`world_ledger.premise` is ordinary story state once approved. It is a starting condition, not a contract — prose is disposable and state is permanent, and later state supersedes it. The draft itself is retained with `status='approved'` and its `story_id`, so "how was this story created?" stays answerable.
