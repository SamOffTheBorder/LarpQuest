## Why

Today every OpenRouter call in the engine reads one platform key — `serverEnv().OPENROUTER_API_KEY` — hardcoded at ~15 call sites (turns, moderation, memory, research, gatekeeper, validator, baseline, universes, and the extraction/image/video workers). The platform pays for every token of every story. There is no way for a user to run a story on their own OpenRouter account, and no way for a GM to choose which models a story uses beyond the two-field narrator/extractor override in story settings.

The `api_keys` table (scope `user`/`story`, AES-256-GCM `encrypted_key`, per-owner RLS) and `crypto.ts` (`encryptSecret`/`decryptSecret`) were built in Phase 1 for exactly this and are currently dead — nothing writes a row and nothing reads one. The `/settings` section (account, spending, appearance) is the natural home for an account-level OpenRouter panel, and `stories.model_config` already resolves per-role model strings through `resolveModel` — it just needs a richer picker.

## What Changes

- **Account settings → OpenRouter panel** (`/settings/openrouter`): the signed-in user pastes their OpenRouter API key. It is encrypted with the existing `encryptSecret` and stored as a `scope='user'`, `provider='openrouter'` row in `api_keys` (one per user — a second save replaces the first). The panel shows a masked fingerprint (last 4 chars) and last-saved time, and a Remove action that deletes the row. The plaintext key is never returned to the client after save, never rendered, never logged.
- **GM-key resolution in the gateway path**: a new `resolveStoryApiKey(storyId)` server helper resolves, in order: (1) the stored user key of whoever holds the `gm` role in `story_members` for that story, (2) the stored user key of the story `owner`, (3) `serverEnv().OPENROUTER_API_KEY`. It returns the decrypted key plus a `source` tag (`gm` | `owner` | `platform`). Every engine call site that currently passes `serverEnv().OPENROUTER_API_KEY` into a gateway `deps` object instead passes the result of this helper. The gateway modules themselves are unchanged — they already take `apiKey` as an injected dep.
- **Per-role model picker for the GM** (story settings): replaces the two narrator/extractor text inputs with a per-role control for every text role — `researcher`, `narrator`, `validator`, `extractor`, `summarizer`, `gatekeeper`, `moderator`. Each role gets a combobox: choose from a **live list of OpenRouter free models** (fetched from `GET https://openrouter.ai/api/v1/models`, filtered to `pricing.prompt === "0" && pricing.completion === "0"`, cached, with a small hardcoded fallback list when the fetch fails) **or** type any model id by hand. Blank = project default, exactly as today. `embedder`, `illustrator`, and `videographer` are left out of this UI — they speak non-chat contracts and their defaults are managed separately.
- **Spend attribution unchanged in shape, clearer in meaning**: `usage_log` rows keep recording `cost_usd` from OpenRouter's `usage.cost`. When a story runs on a GM's own key the cost is still logged (OpenRouter still reports it), so per-story cost views keep working; the row now reflects spend on the GM's account rather than the platform's. No schema change to `usage_log`. The spend-cap guard (`BudgetGuard`) still runs — a GM using their own key can still opt into a per-story cap.

## Capabilities

### Modified Capabilities
- `ai-gateway`: API-key resolution becomes story-aware. The "API key protection" requirement gains scenarios for a user-supplied key: stored encrypted from account settings, resolved by story role (GM → owner → platform fallback), decrypted server-side per call, never returned to the client. Role-based model routing gains a scenario for the GM picking a model from the live OpenRouter free-model list or entering an arbitrary id, persisted to `stories.model_config`.
- `auth-and-accounts`: a new account settings surface — the OpenRouter key panel at `/settings/openrouter` — for saving, fingerprinting, and removing the user's own encrypted OpenRouter key.

## Non-goals

- No `story`-scoped keys in the UI. The `api_keys.scope='story'` path stays in the schema but this change only writes/reads `scope='user'` rows. A per-story key entered by a non-owner is out of scope.
- No key validation round-trip to OpenRouter on save beyond a format check. A bad key surfaces as a failed generation with the existing typed error, not as a save-time rejection. (A lightweight `GET /key` check may be added later.)
- No change to how `BudgetGuard` / spend caps compute or enforce — only the account the spend lands on changes.
- No BYO-key for the `embedder`, `illustrator`, or `videographer` roles' model selection UI, and no change to `media-gateway.ts` beyond threading the resolved key through where it already threads the platform key.
- No billing, credit-balance display, or OpenRouter OAuth. The user pastes a key string.
- No conditional logic on genre/universe/media type anywhere in this change — model selection stays a flat per-role map resolved through the existing dispatch in `roles.ts`.

## Impact

- **Schema**: none. `api_keys`, `usage_log`, `stories.model_config`, and `story_members.role` all already exist with the needed shape and RLS.
- **New code**:
  - `apps/web/src/lib/ai/api-key.ts` — `resolveStoryApiKey(storyId): Promise<{ key: string; source: 'gm' | 'owner' | 'platform' }>`, plus `getUserApiKey(userId)` / `saveUserApiKey(userId, plaintext)` / `deleteUserApiKey(userId)` on top of `api_keys` + `crypto.ts`. `server-only`.
  - `apps/web/src/lib/ai/openrouter-models.ts` — `listFreeModels()`: fetch `GET /api/v1/models`, filter to zero-priced, cache (in-process TTL), fall back to a hardcoded slug list. `server-only`.
  - `apps/web/src/app/settings/openrouter/page.tsx` + `openrouter-key-form.tsx` + `openrouter-key-actions.ts` — the account panel and its server actions (`saveOpenRouterKeyAction`, `removeOpenRouterKeyAction`).
  - Model-picker UI: a `RoleModelPicker` client component (combobox: free-model list + free-text), rendered per role in the story settings model panel.
- **Modified code**:
  - Every gateway call site passing `serverEnv().OPENROUTER_API_KEY` — `turns.ts`, `moderation/moderate.ts`, `memory/{generate,retrieval,arc-compaction}.ts`, `research/pipeline.ts`, `engine/{gatekeeper,validator,baseline,universes,extraction-worker,image-prompts,chapter-illustration}.ts`, `inngest/functions/generate-chapter-video.ts`, `ai/validator-call.ts` — switches to `await resolveStoryApiKey(storyId)`. Worker call sites that already have a `storyId` in scope pass it straight through; the research pipeline resolves via the universe's originating story.
  - `apps/web/src/app/stories/[storyId]/model-settings.tsx` and `settings-actions.ts` — expanded from narrator/extractor to the full text-role set, `updateModelOverridesAction` generalized to accept a role→model map validated against `MODEL_ROLES` and `modelConfigSchema`.
  - `apps/web/src/lib/env.ts` — `OPENROUTER_API_KEY` stays required (it is the fallback); doc comment updated to say so.
  - Settings nav — add an "OpenRouter" entry alongside Account / Spending / Appearance.
- **Docs**: `docs/docs/reference/model-roles.md` gains a "Bringing your own key" section; `docs/docs/architecture/` ai-gateway page notes the GM → owner → platform resolution order.
- **Tests**: `api-key.test.ts` (resolution order, decrypt, fallback), `openrouter-models.test.ts` (filter + fallback), settings-action tests, and updating the ~15 gateway call-site tests whose `serverEnv` mock currently stands in for the key to instead stub `resolveStoryApiKey`.
