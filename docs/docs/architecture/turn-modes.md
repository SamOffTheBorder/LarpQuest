---
sidebar_position: 12
title: Turn Modes
---

# Turn Modes

Same loop, different prompt template and extraction targets. See [The Turn Loop](/architecture/turn-loop) for the eleven-step loop every mode shares — nothing here changes step 1 (open), 2 (submit), 3 (assemble), 5 (validate), 7 (publish), or 8 (extract). Only step 4 (generate)'s system prompt and step 8's extraction targets vary.

## The dispatch table

```ts
export interface TurnMode {
  name: string;
  systemPrompt: (story: TurnModeStoryContext) => string;
  extractionTargets: readonly string[];
}

const TURN_MODES: Record<string, TurnMode> = {
  freeform: FREEFORM,
  action: ACTION,
  scene: SCENE,
  investigation: INVESTIGATION,
  dialogue: DIALOGUE,
  montage: MONTAGE,
};
```

`resolveTurnMode(mode)` looks the name up and returns what's there. The turn loop calls it and uses the result — it contains no branch on which mode it got, and none on genre, universe, or media type, because those are not inputs to the engine at all. Phase 1 registered exactly one entry, `freeform`; Phase 7 added the other five from build plan Part 9. Adding a later mode is a new entry in this table and **no change to the turn loop**.

## The six modes

| Mode | Player submits | Narrator produces | Extractor targets |
|---|---|---|---|
| `action` | Intended action | Resolution with consequences | Capabilities, injuries, resources, deaths |
| `scene` | Intent/emotional goal | A scene, unresolved | Relationships, emotional state, revelations |
| `investigation` | Line of inquiry | Information gated by tracked knowledge state | Knowledge state, evidence, suspicion |
| `dialogue` | What they say/attempt | Conversation turn | What was revealed, standing shifts |
| `montage` | Focus area | Time skip, development summary | Progression across a span |
| `freeform` | Anything | Anything | Generic diff |

Every mode's prompt shares one tail: content-rating and conflict-policy instructions (Phase 1/5), and, when the turn had any Gatekeeper-evaluated proposals, a section reflecting each verdict in the prose (Phase 6). Modes differ only in the lines that precede that shared tail — what the mode asks the model to treat a submission as, and what it asks the model to produce.

## Investigation mode's gating is a prompt instruction, not an engine mechanism

"Information gated by clue graph" (Part 9) is the one mode with behavior beyond prompt text. Rather than inventing a new schema concept for clue graphs, `investigation` mode's system prompt instructs the narrator to reveal only information the acting entity's own tracked knowledge-state field supports — phrased generically, with no reference to what that field is actually called in any given universe:

> Only reveal information the entity's own tracked knowledge state qualifies it for. Do not let a character learn something their prior investigation has not earned, regardless of what would be dramatically convenient.

A universe wanting this mode defines its own knowledge-state field the same way it defines any other [Entity Schema](/architecture/schema-system) field — no new engine mechanism. A universe with no such field simply makes the instruction inert: generation proceeds normally, degrading gracefully to ordinary reveal behavior rather than erroring. The engine does not validate that a universe's schema supports a mode it's running in, matching how the engine doesn't validate schema fit anywhere else either.

## Mode switching

A story's active mode lives in `stories.turn_config.active_mode`, a jsonb key rather than a dedicated column — `turn_config` already existed as a loose bag for turn-level policy (Phase 5's `absent_policy`), and mode is only ever read at turn-creation time, never filtered or joined on.

```ts
export async function switchTurnMode(
  storyId: string,
  userId: string,
  newMode: string,
): Promise<ModeChangeRecord>
```

`switchTurnMode` is owner/GM only (`requireRole(['owner', 'gm'])`), rejects an unregistered mode name before writing anything, and does two things: updates `turn_config.active_mode` (jsonb-merged, so `absent_policy` and any other existing key survives), and inserts a row into `turn_mode_changes` recording the previous mode, the new mode, and who changed it.

### Effective from the next turn, not retroactive

`openTurn` resolves a turn's mode as `options.mode ?? readActiveMode(story.turn_config) ?? 'freeform'`, read fresh at the moment the turn is created. That's the entire mechanism for "takes effect starting with the next turn": there is no separate pending-mode state, no flag, nothing to reconcile. A turn already `open`, `locked`, `generating`, `validating`, or `published` when a switch happens is unaffected, because its `mode` column was already written at its own creation and nothing after that point ever touches it.

```
Turn 1 (scene) ──published
Turn 2 (scene) ──published
        │
        ▼
  [GM switches active_mode: scene → investigation]
        │
        ▼
Turn 3 (investigation) ──published    ← reads the new active_mode at creation
Turn 4 (investigation) ──published
        │
        ▼
  [GM switches active_mode: investigation → action]
        │
        ▼
Turn 5 (action) ──published
```

Turns 1–2 stay `scene` forever; turns 3–4 stay `investigation` forever. The switch only ever affects turns that don't exist yet.

### Why a new table instead of `entity_history`

`entity_history.entity_id` is `not null references entities(id)` — a mode switch is a story-level event with no entity to attach to. Rather than loosening a column that's load-bearing for rollback everywhere else, `turn_mode_changes` mirrors `entity_history`'s exact shape and RLS pattern (append-only: select for any member, insert for owner/GM, no update or delete policy for any non-service-role caller) without the entity requirement it doesn't need.

## Extraction already varied by mode — this phase proved it

The extraction worker (`extraction-worker.ts`) reads a chapter's own stored `turn_mode` and resolves its `extractionTargets` the same way the turn loop resolves a mode's system prompt — this was already true before Phase 7, since `TurnMode.extractionTargets` existed from Phase 1 as "opaque strings the engine passes through and never interprets." What Phase 7 added is the first test proving it: two chapters in different modes produce extractor prompts carrying different target lists, something Phases 1–6 had no way to exercise with only one mode registered.
