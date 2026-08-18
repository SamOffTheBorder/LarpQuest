---
sidebar_position: 1
title: Model Roles
---

# Model Roles

:::danger Never use one model for everything
Roles have genuinely different requirements. Using the expensive creative model for validation wastes money on a narrow structured task; using the cheap model for narration produces prose users will not tolerate.
:::

Models are assigned by role, configurable per-universe and per-story, all routed through OpenRouter.

| Role | Requirements | Notes |
|---|---|---|
| **Researcher** | Web search, long context, strong synthesis | Runs once at universe creation. Expensive, worth it. |
| **Narrator** | Creative, long output (4–8k tokens) | The prose model. Users will care most about this one. |
| **Validator** | Fast, cheap, structured output | Narrow task. Do not use the expensive model here. |
| **Extractor** | Structured output, reliable JSON | Emits state diffs. Schema-constrained. |
| **Summarizer** | Mid-tier, cheap | Runs on every chapter. |
| **Gatekeeper** | Reasoning-capable | Evaluates proposed new capabilities. Quality matters. |
| **Embedder** | Embedding model | Retrieval. |

## Cost profile

The roles differ enormously in how often they run:

- **Researcher** runs once per universe. Cost is amortized across an entire campaign.
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

## Routing rules

1. **No call site hardcodes a model string.** Every call declares its role; the gateway resolves the model.
2. **Every structured output is parsed through a Zod schema** before it reaches the database.
3. **A schema validation failure retries once** with the error appended to the prompt, then raises a typed error. A model that fails a schema twice usually fails it persistently.
4. **Every call writes a `usage_log` row** — including calls that fail after the provider has already billed tokens, so cost reporting is not understated by failures.

## Phase 1 scope

Only **narrator** and **extractor** are populated in Phase 1. The full role table exists as typed constants from the start, so later phases fill in entries rather than introducing the concept.

## API key handling

- Encrypted at rest with AES-256-GCM; master key in the environment, never in the database
- Decrypted server-side per request, never sent to the client
- Two modes: **Owner Pays** (one key for the room) or **BYOK** (each member supplies their own)
- Per-story and per-user spend caps with a hard stop
- Running cost shown in the UI at all times

The application refuses to start without the master key — preventing the failure mode where keys get written unencrypted because an environment variable was missing.
