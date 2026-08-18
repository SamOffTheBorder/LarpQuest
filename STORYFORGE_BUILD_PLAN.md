# StoryForge — Build Plan

**A universe-agnostic, multiplayer, AI-driven collaborative fiction engine.**

This document is the implementation spec. It is written to be handed directly to Claude Code. Read the whole thing before writing code — the architecture decisions in Part 1 constrain everything in Parts 2–8.

---

## Part 0: The Core Thesis

Three ideas drive every architectural decision. If a design choice conflicts with one of these, the design choice is wrong.

**1. Prose is disposable. State is permanent.**
Generated chapters are the *output*, not the source of truth. The source of truth is a structured database of entities, world facts, and relationships. Chapters are rendered from state, and state is updated from chapters. A story that has run 100 chapters must be as coherent as one that has run 5, and that is only possible if the AI is reading structured state rather than trying to remember prose.

**2. The engine knows nothing about any specific fiction.**
No hardcoded concept of "power level," "magic," "combat," or "abilities." A universe defines its own vocabulary via schema. The same engine must run a superhero war, a courtroom drama, a cozy village mystery, and a hard sci-fi negotiation without a single conditional branching on genre.

**3. Research before writing.**
Before a story begins, the system conducts deep automated research into the target universe and produces a Canon Bible that the human owner reviews and corrects. Everything downstream — validation, progression gating, tone — depends on this artifact being accurate. This is the single highest-leverage feature in the product.

---

## Part 1: System Architecture

### 1.1 The Five Layers

| Layer | Mutability | Purpose |
|---|---|---|
| **Canon** | Curated, versioned | The universe bible. Rules, established facts, power scaling, tone. Produced by research, corrected by humans. |
| **Schema** | Per-universe | Defines what an entity *is* in this universe. Drives forms, validation, and state extraction. |
| **Entity** | Live, versioned | Characters, factions, locations, items. Structured records conforming to Schema. |
| **Narrative** | Append-only | Chapters. Prose + summary + embedding + extracted diffs. |
| **Context Pool** | Ephemeral | The assembled prompt. Built fresh every turn, never stored. |

The Context Pool is not a database table. It is a function: `assembleContext(story, turn) -> string`. This is the most important function in the codebase.

### 1.2 The Turn Loop

Every turn mode, every genre, every universe uses this identical loop:

```
1. OPEN      GM (or system) opens turn, optionally sets scene
2. SUBMIT    Players submit actions; lock on deadline or when all in
3. ASSEMBLE  Build Context Pool from Canon + Schema + Entities + Narrative
4. GENERATE  Narration model writes the chapter
5. VALIDATE  Validator model checks against Canon + Schema + entity state
6. GATE      Blocking violations → regenerate (max 2 retries) or escalate to GM
7. PUBLISH   Chapter written to Narrative layer
8. EXTRACT   State extraction produces JSON diffs
9. APPLY     Diffs auto-apply or queue for GM approval (configurable)
10. INDEX    Summary + embedding generated and stored
11. NEXT     New turn opens
```

Steps 5, 8, and 3 are what make long stories work. Do not skip them to ship faster.

### 1.3 Model Roles

Never use one model for everything. Assign by role, configurable per-universe and per-story.

| Role | Requirements | Notes |
|---|---|---|
| **Researcher** | Web search, long context, strong synthesis | Runs once at universe creation. Expensive, worth it. |
| **Narrator** | Creative, long output (4–8k tokens) | The prose model. Users will care most about this one. |
| **Validator** | Fast, cheap, structured output | Narrow task. Do not use the expensive model here. |
| **Extractor** | Structured output, reliable JSON | Emits state diffs. Schema-constrained. |
| **Summarizer** | Mid-tier, cheap | Runs on every chapter. |
| **Gatekeeper** | Reasoning-capable | Evaluates proposed new capabilities. Quality matters. |
| **Embedder** | Embedding model | Retrieval. |

All routed through OpenRouter. Store model strings per role in story settings with sensible defaults.

---

## Part 2: Universe Initialization (The Research Phase)

This is the flagship feature. When a user creates a new universe, they should not fill out a hundred forms. They should type a name and watch the system build the bible.

### 2.1 The Flow

```
User input:
  - Universe name (e.g. "Jujutsu Kaisen")
  - Optional: source materials (uploaded PDFs, wiki URLs, pasted text)
  - Optional: canon cutoff point ("anime only", "manga through ch. 236")
  - Optional: AU/divergence notes ("this is an AU where X never happened")

    ↓

RESEARCH PIPELINE (async job, 5–15 min, progress streamed to user)

    ↓

Draft Canon Bible + Draft Entity Schema + Draft Rule Pack + Draft Seed Entities

    ↓

HUMAN REVIEW UI — accept / edit / reject each section

    ↓

Universe v1.0 published, story can begin
```

### 2.2 The Research Pipeline

Run these as discrete, individually retryable sub-jobs. Each writes to a shared draft document.

**Stage 1 — Scoping**
Identify what kind of universe this is. Emit a classification that drives every later stage:
```json
{
  "media_type": "manga|novel|film|game|original",
  "genre_tags": ["shonen", "action", "supernatural"],
  "has_power_system": true,
  "power_system_type": "discrete_abilities|numeric_scaling|skill_tree|resource_cost|none",
  "scale_ceiling": "planetary",
  "primary_conflict_mode": "combat|social|investigative|survival|mixed",
  "tone": ["dark", "escalating", "tragic"],
  "recommended_turn_modes": ["action", "scene"]
}
```

**Stage 2 — Rules & Mechanics**
Research and document the universe's hard rules. What is possible, what is impossible, what has a cost. Output structured rule objects, each with a citation or a confidence flag.

**Stage 3 — Power/Progression System**
If `has_power_system`, document it in depth: how abilities are gained, what limits exist, how scaling works, what the established tiers are, what the known ceiling is. This becomes the Gatekeeper's reference document. **This stage matters more than any other for long-running stories.**

**Stage 4 — Canonical Entities**
Major characters, factions, locations. For each: name, role, capabilities, status at the canon cutoff, key relationships. Flag anyone dead/incapacitated at cutoff.

**Stage 5 — Timeline & Canon State**
Where does the story start? What has already happened? What is currently unresolved? This becomes the story's opening world ledger.

**Stage 6 — Schema Derivation**
Based on Stages 1–3, propose the Entity Schema. A shonen universe gets `abilities[]`, `power_tier`, `drawbacks`. A mystery gets `knows[]`, `suspicion_level`, `alibi`. A political drama gets `faction_standing{}`, `secrets[]`, `leverage[]`. **The schema is derived from research, not chosen from a menu.**

**Stage 7 — Rule Pack Generation**
Convert Stage 2 rules into validation rules with severity levels. Include a "tone rules" section — a comedy universe should flag grimdark drift; a horror universe should flag levity.

**Stage 8 — Confidence & Gaps Report**
Explicitly list what the research could not determine. This is shown prominently in review — users need to know where the bible is guessing.

### 2.3 Human Review UI

Non-negotiable. Research will be wrong sometimes, and users will want AU divergence.

- Section-by-section accept/edit/reject
- Every researched fact shows a confidence indicator and source when available
- "Add house rule" — freeform text rules the user writes themselves
- "Mark as AU" on any canon fact — the divergence is recorded and validators respect it
- Diff view when re-running research later

### 2.4 Universe Versioning

Universes are versioned and forkable. Editing a universe mid-story creates a new version; the story pins to a version and can opt into upgrades. This prevents a canon edit from retroactively invalidating 40 chapters.

---

## Part 3: The Schema System

### 3.1 Entity Schema Definition

```json
{
  "entity_types": {
    "character": {
      "label": "Character",
      "fields": [
        {"key": "name", "type": "string", "required": true},
        {"key": "description", "type": "text"},
        {"key": "cursed_technique", "type": "string", "label": "Cursed Technique"},
        {"key": "grade", "type": "enum",
         "values": ["Grade 4", "Grade 3", "Grade 2", "Grade 1", "Special Grade"]},
        {"key": "abilities", "type": "capability_list"},
        {"key": "cursed_energy", "type": "resource", "max": 100},
        {"key": "status", "type": "enum",
         "values": ["healthy", "injured", "critical", "incapacitated", "dead"]},
        {"key": "relationships", "type": "relationship_map"}
      ]
    },
    "faction": { "fields": [...] },
    "location": { "fields": [...] }
  }
}
```

### 3.2 Field Types (Engine-Provided Primitives)

| Type | Renders as | Extracted by | Used for |
|---|---|---|---|
| `string`, `text` | input / textarea | free text diff | names, descriptions |
| `enum` | select | value change | status, tier, rank |
| `number` | input | numeric diff | levels, counts, resources |
| `resource` | gauge | current/max diff | mana, stamina, ammo |
| `capability_list` | list editor | add/remove/status-change | powers, skills, spells, techniques |
| `relationship_map` | matrix editor | edge weight diff | trust, rivalry, affection |
| `knowledge_set` | tag list | fact added/removed | who knows what (mystery) |
| `standing_map` | matrix | reputation delta | faction politics |
| `tag_list` | chips | add/remove | traits, conditions, flags |
| `reference` | entity picker | link change | location, allegiance |

These primitives are the entire engine vocabulary. Universes compose them. The engine never adds a domain-specific type.

### 3.3 Capability Object

The most important composite type. Used by any universe with progression.

```json
{
  "id": "uuid",
  "name": "Hollow Purple",
  "description": "...",
  "status": "proposed|developing|available|mastered|lost|sealed",
  "cost": "Significant cursed energy expenditure",
  "limits": "Requires both Blue and Red to be usable simultaneously",
  "unlocked_at_chapter": 34,
  "gatekeeper_ruling": {
    "verdict": "allow_with_limits",
    "reasoning": "...",
    "imposed_limits": ["..."]
  }
}
```

---

## Part 4: Progression Models

Shipped as plugins. A universe selects zero, one, or several. Each model defines: what state it tracks, how the Gatekeeper evaluates proposals, and what the Extractor looks for.

| Model | Tracks | Gatekeeper asks |
|---|---|---|
| `ability_unlock` | Discrete capabilities with status | "Has this character earned this? Does it fit their established technique?" |
| `numeric_scaling` | Single power value | "Is this jump proportionate to what happened?" |
| `skill_tree` | Levels, stats, branches | "Do they have the prerequisites and the points?" |
| `resource_cost` | Consumable pools | "Can they afford this? What is depleted?" |
| `knowledge_state` | Facts known per entity | "Could they know this? Who told them?" |
| `relationship_web` | Weighted edges | "Is this shift earned by what has happened between them?" |
| `reputation` | Standing per faction | "Does this action plausibly move standing this much?" |
| `none` | Continuity only | Gatekeeper disabled |

**Design constraint:** adding a new progression model must require zero changes to the turn loop. It only registers: a schema fragment, a Gatekeeper prompt template, and an Extractor target list.

---

## Part 5: Validation & Gatekeeping

### 5.1 Validation Rules

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

Severity levels:
- `block` — regenerate the chapter with the violation in the prompt. Max 2 retries, then escalate to GM.
- `warn` — publish, but flag visibly. GM can dismiss or revise.
- `log` — record silently for the consistency report.

### 5.2 Standard Rule Pack (Engine-Provided)

Applied to every universe unless disabled:
- Dead/incapacitated entities cannot act
- Entities cannot be in two locations simultaneously
- Destroyed items/locations remain destroyed
- Capability gating (when a progression model is active)
- Established canon facts not contradicted
- Player-submitted intent was actually addressed

### 5.3 Research-Derived Rules

Stage 7 of research generates universe-specific rules. Examples across genres:

- *Shonen:* "Power increases require a narrative cause — training, stakes, or emotional trigger. Flag unexplained escalation."
- *Mystery:* "No character may act on information they have not been shown to receive."
- *Hard sci-fi:* "No faster-than-light communication. Flag any instantaneous coordination across distance."
- *Comedy:* "Tone should not become sustained grimdark. Flag if three consecutive chapters contain no levity."

### 5.4 The Gatekeeper

Separate from validation. Runs when a player proposes something *new* — a capability, an alliance, a deduction, a plot development.

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

This is the feature that keeps long campaigns coherent. It is also the feature that makes the AI feel like a real GM rather than a yes-machine. Invest in the prompt quality here.

### 5.5 GM Override

Every flag needs one-click approval that **writes an exception into canon**, so it never re-flags. Intentional rule-breaking is a legitimate creative choice. The system must support it without friction and must remember it.

---

## Part 6: Memory & Context Assembly

### 6.1 Per-Chapter Artifacts

On publish, generate and store:
- **Full prose** (for humans)
- **Structured summary** — what happened, who was involved, what changed (for context)
- **Embedding** — of the summary, not the prose (better retrieval signal)
- **Extracted diffs** — the state changes
- **Entity index** — which entities appeared (for filtered retrieval)

### 6.2 The Assembly Function

```
assembleContext(story, turn):
  ALWAYS:
    - Canon Bible (compressed; full rules, condensed lore)
    - Entity Schema
    - All entities with status = active
    - World ledger (deaths, destructions, unresolved threads, active threats)
    - Story tone/style directives

  RECENT:
    - Last N chapters in full prose (default 2–3)

  RETRIEVED:
    - Top-K chapter summaries by vector similarity to current turn input
    - Biased per universe context_policy

  CURRENT:
    - This turn's scene setup
    - All player submissions
    - Any Gatekeeper rulings from this turn
```

### 6.3 Context Policy (Per Universe)

```json
{
  "recent_chapters": 3,
  "retrieved_chapters": 5,
  "retrieval_bias": "precedent|information|emotional|thematic",
  "canon_compression": "full|summary|rules_only",
  "token_budget": 24000
}
```

- `precedent` — action universes. "How did this power work before?"
- `information` — mysteries. "What has been revealed?"
- `emotional` — drama. "What is the history between these characters?"
- `thematic` — literary. "What motifs are running?"

### 6.4 Long-Story Compaction

Beyond ~50 chapters, generate **arc summaries** — one summary per 10–15 chapters — and retrieve at arc granularity for distant history, chapter granularity for recent. Prevents linear context growth.

---

## Part 7: Multiplayer

### 7.1 Roles

| Role | Can |
|---|---|
| **Owner** | Everything. Manages universe, keys, billing. |
| **GM** | Open/close turns, override validation, edit entities, revise chapters, invite |
| **Player** | Claim entities, submit actions, propose capabilities, vote |
| **Spectator** | Read only |

Owner can run GM-less (system auto-opens turns) or GM-led.

### 7.2 Turn Coordination

- Configurable deadline (default 24h, adjustable per story)
- Lock when all submitted OR deadline hits
- Absent players: configurable — skip, AI-plays-them, or block
- Realtime presence: "Waiting on 2 of 5 players"
- Player can edit their submission until lock

### 7.3 Conflict Resolution

When two players submit contradictory actions (both grab the same object, one saves an NPC the other kills), the Narrator must resolve rather than pick arbitrarily. Provide the resolution policy in the prompt:

```json
"conflict_policy": "narrative_priority|initiative_order|gm_ruling|both_partially_succeed"
```

Default: `narrative_priority` — resolve in whatever way makes the best story, and make the reasoning visible in the prose.

### 7.4 Entity Ownership

- A player claims one or more entities
- Only the owner (or GM) submits actions for that entity
- If a player leaves, their entity becomes GM-controlled or is written out
- Character death: player is prompted to create a new entity or become spectator

### 7.5 Safety in Shared Rooms

Multiplayer means people who do not know each other. Required:
- Content rating set at story creation, enforced in the Narrator system prompt
- Report/block at the room level
- Owner can remove members and revoke invite links
- Submission-level moderation pass before content reaches other players
- Do not let one player's submission steer the story into content another player did not consent to

---

## Part 8: Technical Specification

### 8.1 Stack

| Concern | Choice | Rationale |
|---|---|---|
| Framework | Next.js (App Router) | Frontend + API in one deployable |
| Language | TypeScript, strict | Non-negotiable at this complexity |
| Database | Postgres via Supabase | Relational + `jsonb` + `pgvector` in one |
| Auth | Supabase Auth | Magic link + OAuth |
| Realtime | Supabase Realtime | Presence and turn state, no custom WS |
| Jobs | Inngest or Trigger.dev | Research pipeline needs durable multi-step jobs |
| Validation | Zod | Every AI structured output parsed through a schema |
| UI | Tailwind + shadcn/ui | Do not hand-write CSS |
| AI Gateway | OpenRouter | One API, model-per-role |
| Hosting | Vercel | Free tier sufficient to launch |

### 8.2 Schema (Core Tables)

```sql
-- Universes
create table universes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users,
  name text not null,
  version int not null default 1,
  forked_from uuid references universes(id),
  classification jsonb not null,      -- Stage 1 output
  canon_bible jsonb not null,         -- Stages 2-5 output
  entity_schema jsonb not null,       -- Stage 6 output
  progression_models text[] not null,
  validation_rules jsonb not null,    -- Stage 7 output
  context_policy jsonb not null,
  turn_modes text[] not null,
  research_gaps jsonb,                -- Stage 8 output
  is_public boolean default false,
  created_at timestamptz default now()
);

-- Stories
create table stories (
  id uuid primary key default gen_random_uuid(),
  universe_id uuid references universes(id),
  universe_version int not null,      -- pinned
  owner_id uuid references auth.users,
  title text not null,
  content_rating text not null,
  model_config jsonb not null,        -- model string per role
  turn_config jsonb not null,         -- deadline, absent policy, conflict policy
  world_ledger jsonb not null default '{}',
  current_turn int default 0,
  status text default 'active',
  created_at timestamptz default now()
);

-- Members
create table story_members (
  story_id uuid references stories(id) on delete cascade,
  user_id uuid references auth.users,
  role text not null,                 -- owner|gm|player|spectator
  joined_at timestamptz default now(),
  primary key (story_id, user_id)
);

-- Entities
create table entities (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  type text not null,                 -- from entity_schema
  name text not null,
  data jsonb not null,                -- conforms to entity_schema
  controlled_by uuid references auth.users,
  status text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table entity_history (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references entities(id) on delete cascade,
  chapter_id uuid,
  diff jsonb not null,
  applied_by uuid references auth.users,
  created_at timestamptz default now()
);

-- Narrative
create table chapters (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  turn_number int not null,
  turn_mode text not null,
  prose text not null,
  summary text,
  embedding vector(1536),
  entity_ids uuid[],
  extracted_diffs jsonb,
  validation_report jsonb,
  image_prompts jsonb,
  created_at timestamptz default now()
);

create table arc_summaries (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  from_chapter int, to_chapter int,
  summary text not null,
  embedding vector(1536)
);

-- Turns
create table turns (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  turn_number int not null,
  mode text not null,
  scene_setup text,
  status text default 'open',         -- open|locked|generating|published|failed
  deadline timestamptz,
  created_at timestamptz default now()
);

create table submissions (
  id uuid primary key default gen_random_uuid(),
  turn_id uuid references turns(id) on delete cascade,
  entity_id uuid references entities(id),
  user_id uuid references auth.users,
  content text not null,
  proposals jsonb,                    -- new capabilities etc.
  submitted_at timestamptz default now()
);

-- Gatekeeper
create table proposals (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  entity_id uuid references entities(id),
  proposal text not null,
  verdict text,
  reasoning text,
  imposed_limits jsonb,
  gm_override boolean default false,
  created_at timestamptz default now()
);

-- Canon exceptions (GM overrides that become permanent)
create table canon_exceptions (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id) on delete cascade,
  rule_id text not null,
  exception_note text not null,
  created_by uuid references auth.users,
  created_at timestamptz default now()
);

-- Keys and usage
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users,
  scope text not null,                -- user|story
  story_id uuid references stories(id),
  encrypted_key text not null,
  created_at timestamptz default now()
);

create table usage_log (
  id uuid primary key default gen_random_uuid(),
  story_id uuid references stories(id),
  user_id uuid references auth.users,
  role text not null,                 -- which model role
  model text not null,
  prompt_tokens int, completion_tokens int,
  cost_usd numeric(10,6),
  created_at timestamptz default now()
);

-- Indexes
create index on chapters using ivfflat (embedding vector_cosine_ops);
create index on arc_summaries using ivfflat (embedding vector_cosine_ops);
create index on entities using gin (data);
create index on chapters (story_id, turn_number);
```

Enable RLS on every table. Access gated through `story_members`.

### 8.3 API Key Security

- Encrypt at rest with AES-256-GCM; master key in environment, never in DB
- Decrypt server-side per request, never send to client
- Two modes: **Owner Pays** (one key for the room) or **BYOK** (each member supplies their own)
- Per-story and per-user spend caps with hard stop
- Show running cost in the UI at all times

### 8.4 Failure Handling

Generation is the most expensive and most fragile step. Design for failure:

- Turn status machine includes `failed`; a failed turn is retryable without losing submissions
- Never lose player submissions — they persist independently of generation attempts
- Streaming generation with partial save, so a timeout does not discard 4k tokens
- Validation retries capped at 2, then escalate rather than loop
- If extraction fails, publish the chapter anyway and queue extraction for retry — never block publication on state extraction
- Rollback: GM can unpublish a chapter, which reverses its applied diffs via `entity_history`

---

## Part 9: Turn Modes

Same loop, different prompt template and extraction targets.

| Mode | Player submits | Narrator produces | Extractor targets |
|---|---|---|---|
| `action` | Intended action | Resolution with consequences | Capabilities, injuries, resources, deaths |
| `scene` | Intent/emotional goal | A scene, unresolved | Relationships, emotional state, revelations |
| `investigation` | Line of inquiry | Information gated by clue graph | Knowledge state, evidence, suspicion |
| `dialogue` | What they say/attempt | Conversation turn | What was revealed, standing shifts |
| `montage` | Focus area | Time skip, development summary | Progression across a span |
| `freeform` | Anything | Anything | Generic diff |

Modes are switchable mid-story by the GM. A story might run `scene` for setup, `investigation` for the middle, `action` for the climax.

---

## Part 10: Build Order

Do not reorder. Each phase depends on the last.

### Phase 1 — Generic Core *(~3 weeks)*
Auth, story creation, single-player. Entities as `{name, description, data: jsonb}` with no schema enforcement. One hardcoded `freeform` turn mode. Full turn loop: submit → assemble → generate → publish. OpenRouter integration with one model role. Chapters saved and displayed.

**Exit criteria:** A single user can run 10 chapters end to end.

### Phase 2 — Universe System *(~3 weeks)*
Entity Schema definition and storage. Dynamic form rendering from schema. Progression model plugin architecture with two models implemented (`ability_unlock`, `none`). Universe versioning and pinning.

**Exit criteria:** Two structurally different universes (one with powers, one without) run on the same code with no genre conditionals.

### Phase 3 — Research Pipeline *(~3 weeks)*
The 8-stage async job. Progress streaming. Human review UI. Draft → published universe flow. Confidence and gaps reporting.

**Exit criteria:** Typing "Jujutsu Kaisen" produces a usable universe in under 15 minutes with a reviewable bible.

### Phase 4 — Memory *(~2 weeks)*
Summarization, embeddings, vector retrieval, context policy, arc compaction, the full `assembleContext` function.

**Exit criteria:** A 30-chapter story maintains continuity on details established in chapter 3.

### Phase 5 — Multiplayer *(~3 weeks)*
Rooms, invites, roles, entity claiming, turn locks and deadlines, realtime presence, conflict resolution policy, safety controls.

**Exit criteria:** Five people run a story together across a week without coordination outside the app.

### Phase 6 — Validation & Gatekeeping *(~2 weeks)*
Rule engine with severity levels. Validator loop with retry and escalation. Gatekeeper for proposals. GM override writing canon exceptions. Consistency report view.

**Exit criteria:** A player proposing an unearned power gets a reasoned in-universe rejection.

### Phase 7 — Turn Modes *(~2 weeks)*
Implement the remaining five modes. Mid-story mode switching.

### Phase 8 — Polish
Image prompt generation as a first-class per-chapter feature. Full-text search across a story. Export to Markdown/PDF/EPUB. Public read-only share links. Mobile-responsive pass. Universe marketplace — browse, clone, fork published universes.

---

## Part 11: Non-Obvious Requirements

Things that will hurt if deferred:

1. **Universe versioning from Phase 2.** Editing canon mid-story must not retroactively break 40 chapters. Pin the version.

2. **Entity history from Phase 1.** Every state change is a row. Without this, rollback is impossible and debugging drift is guesswork.

3. **Submissions independent of generation.** Player input must survive any number of failed generation attempts.

4. **Cost visibility from day one.** At 8k-token chapters, a long campaign is real money. Surprise bills kill products.

5. **The GM override must write to canon.** An override that does not persist means the same fight every chapter.

6. **Tone rules matter as much as mechanical rules.** The most common failure in long AI stories is not a rules violation — it is genre drift. A comedy becoming grimdark is a bug.

7. **Research gaps must be visible.** Users need to know where the bible is confident and where it is guessing, or they will trust it uniformly and be blindsided.

8. **Never block publication on extraction.** Publish, then extract. A failed extraction should not hold up the story.

---

## Part 12: Launch Universe Templates

Ship three that are *structurally* different, to prove the engine is genuinely generic:

1. **Shonen Action** — `ability_unlock` + `numeric_scaling`, power tiers, `action` and `montage` modes, escalation tone rules
2. **Locked-Room Mystery** — `knowledge_state`, clue graph, zero combat fields, `investigation` and `dialogue` modes, fair-play rules
3. **Court Intrigue** — `reputation` + `relationship_web` + `knowledge_state`, `dialogue` and `scene` modes, no combat, social-consequence rules

If all three run without a single genre-specific branch in the engine, the architecture is correct. If any one requires a special case, the abstraction is wrong and should be fixed before Phase 7.

---

## Appendix A: Prompt Template Skeletons

### Narrator
```
You are the narrator for a collaborative story in {universe.name}.

## Universe Rules
{canon_bible.rules}

## Tone
{universe.classification.tone} — maintain this register.

## Current State
{active_entities}
{world_ledger}

## Recent Events
{recent_chapters}

## Relevant History
{retrieved_summaries}

## This Turn
Mode: {turn_mode}
Scene: {scene_setup}
Player actions:
{submissions}

## Rulings
{gatekeeper_rulings}

## Constraints
- Every player action must be meaningfully addressed
- Only use capabilities listed as available on each entity
- Respect all universe rules; violations will be rejected
- Conflict resolution policy: {conflict_policy}
- Target length: {target_length}

Write the chapter.
```

### Validator
```
You are a consistency checker. You are not writing; you are auditing.

## Rules
{validation_rules}

## Entity State
{entities}

## Canon Exceptions (do not flag these)
{canon_exceptions}

## Chapter Under Review
{chapter}

Output JSON:
{ "violations": [ { "rule_id", "severity", "excerpt", "explanation" } ] }
Empty array if clean.
```

### Gatekeeper
```
You are the arbiter of what is possible in {universe.name}.

## Power/Progression System
{canon_bible.progression_system}

## Entity's Current State
{entity}

## Their Established History
{entity_relevant_chapters}

## Proposal
{proposal}

Rule on this. Output JSON:
{ "verdict": "allow|allow_with_limits|reject",
  "reasoning": "in-universe explanation",
  "imposed_limits": [],
  "narrative_cost": "what this should cost them",
  "suggested_alternative": "if rejected" }

Be a good GM: favor "allow_with_limits" over flat rejection where possible.
A cost that makes the story better is preferable to a no.
```

### Extractor
```
Extract state changes from this chapter.

## Entity Schema
{entity_schema}

## Entities Before
{entities}

## Chapter
{chapter}

Output JSON array of diffs. Only include fields that actually changed.
{ "diffs": [ { "entity_id", "field", "from", "to", "evidence" } ] }
```

---

## Appendix B: First Milestone

The smallest thing worth building:

> One user, one universe created by hand (no research), five entities, ten chapters generated with structured state that updates correctly and demonstrably improves chapter 10's consistency versus a no-state baseline.

If that works, everything else is scaling. If it does not, no amount of multiplayer or research will save it.
