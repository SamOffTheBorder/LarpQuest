---
sidebar_position: 1
title: Model Roles
---

# Model Roles

:::danger Never use one model for everything
Roles have genuinely different requirements. Using the expensive creative model for validation wastes money on a narrow structured task; using the cheap model for narration produces prose users will not tolerate.
:::

Models are assigned by role, configurable per-universe and per-story, routed through OpenRouter — with one exception, noted below.

| Role | Requirements | Notes |
|---|---|---|
| **Researcher** | Web search, long context, strong synthesis | Runs once at universe creation. Expensive, worth it. |
| **Premise** | Creative, structured output | Drafts a story premise before turn 1. Runs before any story exists, so it resolves through role defaults. |
| **Narrator** | Creative, long output (4–8k tokens) | The prose model. Users will care most about this one. |
| **Validator** | Fast, cheap, structured output | Narrow task. Do not use the expensive model here. |
| **Extractor** | Structured output, reliable JSON | Emits state diffs. Schema-constrained. |
| **Summarizer** | Mid-tier, cheap | Runs on every chapter. |
| **Gatekeeper** | Reasoning-capable | Evaluates proposed new capabilities. Quality matters. |
| **Embedder** | Embedding model | Retrieval. |
| **Moderator** | Fast, cheap, classification | Runs once per turn lock, on the critical path to generation. |
| **Illustrator** | Image generation | Renders manga-panel images from chapter content. Phase 8. |
| **Videographer** | Video generation | Renders an anime-style clip per chapter. Phase 8, opt-in, off by default. Not routed through OpenRouter — see below. |

## Cost profile

The roles differ enormously in how often they run:

- **Researcher** runs once per universe. Cost is amortized across an entire campaign.
- **Premise** runs a handful of times at story creation — once per generate or re-roll — and never again.
- **Narrator** runs once per turn, with the largest output. This dominates the bill.
- **Summarizer** and **Embedder** run once per chapter on small inputs.
- **Validator** runs once per turn, plus once per retry.
- **Gatekeeper** runs only when a player proposes something new — rare, so a reasoning-capable model is affordable here.

## Configuration

Model strings are stored per role in `stories.model_config`, seeded with defaults at story creation so a story is runnable without configuration.

```json
{
  "narrator": "...",
  "validator": "...",
  "extractor": "...",
  "summarizer": "...",
  "gatekeeper": "...",
  "embedder": "..."
}
```

A missing role falls back to that role's documented default and records the fallback, rather than failing the call. A role name outside the defined table is rejected as a validation error.

The story owner or GM sets these from **Model settings** on the story page. Each configurable text role (`researcher`, `narrator`, `validator`, `extractor`, `summarizer`, `gatekeeper`, `moderator`) gets a picker offering the current list of zero-priced ("free") OpenRouter models — fetched live from `GET /api/v1/models`, with a small hardcoded fallback when that fetch fails — plus a **Custom…** option for entering any model id by hand. `embedder`, `illustrator`, and `videographer` are not in this picker; they use non-chat contracts and keep their defaults.

## Routing rules

1. **No call site hardcodes a model string.** Every call declares its role; the gateway resolves the model.
2. **Every structured output is parsed through a Zod schema** before it reaches the database.
3. **A schema validation failure retries once** with the error appended to the prompt, then raises a typed error. A model that fails a schema twice usually fails it persistently.
4. **Every call writes a `usage_log` row** — including calls that fail after the provider has already billed tokens, so cost reporting is not understated by failures.

## The video-generation exception

**Illustrator** stays on the `gateway.ts` path where OpenRouter serves an image-output model. **Videographer** does not — no current-generation video model is available through OpenRouter, so it calls a direct provider API through a separate `media-gateway.ts`. This is the one role that doesn't route through OpenRouter's chat-completions contract, because image and video generation return binary/URL output rather than token-priced text, and video generation is asynchronous rather than a single request/response. The role-resolution and `usage_log` contract above still applies identically — only the transport differs, and it's isolated entirely inside `media-gateway.ts`. See [Phase 8](/phases/phase-8-polish) for why.

## Phase 1 scope

Only **narrator** and **extractor** are populated in Phase 1. The full role table exists as typed constants from the start, so later phases fill in entries rather than introducing the concept.

## API key handling

- Encrypted at rest with AES-256-GCM; master key in the environment, never in the database
- Decrypted server-side per request, never sent to the client
- Per-story and per-user spend caps with a hard stop
- Running cost shown in the UI at all times

The application refuses to start without the master key — preventing the failure mode where keys get written unencrypted because an environment variable was missing.

### Bringing your own OpenRouter key

A user saves their own OpenRouter key at **Settings → OpenRouter**. It is encrypted and stored as a single user-scoped row; only its last-4 fingerprint is ever shown again.

When a story generates, the gateway resolves which key to bill in this order:

1. The **GM** member's saved key
2. failing that, the story **owner**'s saved key
3. failing that, the platform `OPENROUTER_API_KEY`

The source is recorded on the call. Story-less calls (universe research, canon-bible compression) always use the platform key. Costs are still written to `usage_log` and shown in per-story spend views regardless of which key was used — OpenRouter reports the cost either way; this only changes which account the spend lands on.
