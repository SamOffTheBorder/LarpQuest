## 1. Key storage helpers

- [x] 1.1 `apps/web/src/lib/ai/api-key.ts` (`server-only`): `getUserApiKey(userId)` — select the user's `scope='user'`, `provider='openrouter'` row, return `{ encryptedKey, label, createdAt } | null`. `saveUserApiKey(userId, plaintext)` — basic format check (non-empty, `sk-or-` prefix tolerated but not required), `encryptSecret`, upsert so at most one row per user (delete-then-insert or `on conflict`). `deleteUserApiKey(userId)`.
- [x] 1.2 Same file: `fingerprint(plaintext)` → last 4 chars, used only server-side to compute the masked value passed to the client.
- [x] 1.3 Same file: `resolveStoryApiKey(storyId): Promise<{ key: string; source: 'gm' | 'owner' | 'platform' }>` — look up `story_members` for the `gm` role user id, then `stories.owner_id`; for each, load and `decryptSecret` their user key; return the first that exists, else `serverEnv().OPENROUTER_API_KEY` with `source: 'platform'`. Uses the service-role client (call sites are server engine code, not user-scoped requests). Also added `resolvePlatformApiKey()` for story-less call paths.
- [x] 1.4 `apps/web/src/lib/ai/api-key.test.ts`: resolution order (gm present; gm absent + owner present; neither → platform), decrypt round-trip, malformed-ciphertext row is skipped rather than throwing, replace-on-save keeps one row.

## 2. OpenRouter free-model list

- [x] 2.1 `apps/web/src/lib/ai/openrouter-models.ts` (`server-only`): `listFreeModels(): Promise<{ id: string; name: string }[]>` — `GET https://openrouter.ai/api/v1/models`, filter `pricing.prompt === '0' && pricing.completion === '0'`, map to `{ id, name }`, sort by name. In-process cache with a TTL (e.g. 1h). On fetch/parse failure, return `FALLBACK_FREE_MODELS` (a hardcoded array of ~6 known `:free` slugs) and do not cache the failure.
- [x] 2.2 `apps/web/src/lib/ai/openrouter-models.test.ts`: filter keeps only zero-priced entries, fetch failure yields the fallback list, cache hit skips the second fetch.

## 3. Account settings — OpenRouter key panel

- [x] 3.1 `apps/web/src/app/settings/openrouter/openrouter-key-actions.ts` (`'use server'`): `saveOpenRouterKeyAction(prev, formData)` — `requireUser()`, read `key`, call `saveUserApiKey`, `revalidatePath('/settings/openrouter')`, return typed state. `removeOpenRouterKeyAction` — `requireUser()`, `deleteUserApiKey`, revalidate.
- [x] 3.2 `apps/web/src/app/settings/openrouter/openrouter-key-form.tsx` (`'use client'`): `useActionState` form. Empty state = single password-type input + Save. Saved state = fingerprint (`••••••••1234`), saved time, and a Remove button (its own action). Error text from action state.
- [x] 3.3 `apps/web/src/app/settings/openrouter/page.tsx`: `requireUser()`, `getUserApiKey`, compute fingerprint server-side, render the form. Copy: what a key is for, that stories you GM will use it, link to openrouter.ai/keys.
- [x] 3.4 Add an "OpenRouter" entry to the settings nav (wherever Account / Spending / Appearance are listed).
- [x] 3.5 Action tests: save writes an encrypted row, remove deletes it, blank submission returns an error, unauthenticated is rejected.

## 4. Story model settings — per-role picker

- [x] 4.1 `apps/web/src/app/stories/[storyId]/role-model-picker.tsx` (`'use client'`): combobox for one role — a `<select>`/listbox seeded from the free-model list plus a "Custom…" option that reveals a text input; current value (from `model_config` or blank) preselected. Emits the chosen id (or empty) under `name={role}`.
- [x] 4.2 `apps/web/src/app/stories/[storyId]/model-settings.tsx`: replace the two hardcoded fields with `RoleModelPicker` rendered for each of `researcher`, `narrator`, `validator`, `extractor`, `summarizer`, `gatekeeper`, `moderator`. Fetch `listFreeModels()` in the parent server component and pass down. Keep the collapse/expand behavior. Update the helper copy.
- [x] 4.3 `apps/web/src/app/stories/[storyId]/settings-actions.ts`: generalize `updateModelOverridesAction` — iterate `MODEL_ROLES` (text roles only), read each from `formData`, build the next `model_config` (set trimmed non-empty, delete blank), validate the whole map through `modelConfigSchema`, `updateStoryModelConfig`. Keep owner/GM authorization as-is via `getStory`.
- [x] 4.4 Restrict the picker UI + action to `owner`/`gm` (mirror whatever `member-roles` check story settings already uses; the action already goes through `getStory(storyId, user.id)`).
- [x] 4.5 Tests: setting several roles persists them, blanking one removes it, an unknown role name in form data is ignored, a non-member/`player` is rejected.

## 5. Wire the resolver into every gateway call site

- [x] 5.1 `apps/web/src/lib/engine/turns.ts` (`generateTurn`): replace `apiKey: serverEnv().OPENROUTER_API_KEY` with `apiKey: (await resolveStoryApiKey(turn.storyId)).key`.
- [x] 5.2 `apps/web/src/lib/moderation/moderate.ts`: same, using the `storyId` already in scope.
- [x] 5.3 `apps/web/src/lib/memory/{generate,retrieval,arc-compaction}.ts`: same; thread `storyId` in if a helper lacks it.
- [x] 5.4 `apps/web/src/lib/engine/{gatekeeper,validator,baseline,universes}.ts` and `apps/web/src/lib/ai/validator-call.ts`: same.
- [x] 5.5 Workers — `apps/web/src/lib/engine/{extraction-worker,image-prompts,chapter-illustration}.ts` and `apps/web/src/inngest/functions/generate-chapter-video.ts`: resolve from the job's `storyId`. For image/video these currently pass `openRouterApiKey`/`openRouterApiKey` into `media-gateway` — pass the resolved key there.
- [x] 5.6 `apps/web/src/lib/research/pipeline.ts`: resolve via the universe draft's originating story id; if a research run has no story context, fall back to platform (`resolveStoryApiKey` handles a null-ish path or add `resolvePlatformApiKey()`).
- [x] 5.7 Update the ~15 call-site test files that mock `serverEnv` to return `OPENROUTER_API_KEY`: instead mock `resolveStoryApiKey` to return `{ key: 'test-key', source: 'platform' }`. Keep `serverEnv` mocks where other env vars (`WORKER_SECRET`) are read.
- [x] 5.8 `apps/web/src/lib/env.ts`: keep `OPENROUTER_API_KEY` required; update the comment to note it is the platform fallback when no GM/owner key is set.

## 6. Docs

- [x] 6.1 `docs/docs/reference/model-roles.md`: add "Bringing your own OpenRouter key" — how to save it in account settings, the GM → owner → platform resolution order, that cost still shows in story spend views because OpenRouter reports it.
- [x] 6.2 `docs/docs/architecture/` ai-gateway page: document `resolveStoryApiKey` and the per-role free-model picker. `npm run build` in `docs` stays clean.

## 7. Verification

- [x] 7.1 From `apps/web`: `npm test`, `npm run typecheck`, `npm run build` all pass.
- [x] 7.2 `openspec validate gm-openrouter-keys --strict` passes.
- [ ] 7.3 Manual: save a key in `/settings/openrouter`, create a story you GM, run a turn, confirm the `usage_log` row is written and the turn used the configured model.
