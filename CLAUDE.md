# StoryForge — Working Notes

`STORYFORGE_BUILD_PLAN.md` is the authoritative spec. Read the relevant part before implementing. Where this file and the build plan disagree, the build plan wins.

## Layout

```
apps/web/     Next.js 15 App Router, TypeScript strict, Tailwind, shadcn/ui
docs/         Docusaurus 3 — architecture docs (npm run build must stay clean)
openspec/     Spec-driven changes; config.yaml holds project context and rules
```

## Non-negotiable constraints

These are the ones that are easy to violate accidentally:

1. **No conditionals on genre, universe, or media type in engine code.** Ever. Turn modes and progression models resolve through dispatch tables, not branches. This is the single most important rule in the project.
2. **Never block publication on extraction.** Publish the chapter, then extract state. A failed extraction queues a retry; it never delays or reverses publication.
3. **Every state change writes an `entity_history` row.** Append-only — rollback writes compensating rows rather than deleting originals.
4. **Submissions persist independently of generation.** No generation outcome may delete or alter a submission. A `failed` turn is retryable and reuses the originals.
5. **RLS on every table in the migration that creates it**, gated through `story_members`.
6. **Every model call declares a role** from the role table and resolves its model from `stories.model_config`. No hardcoded model strings at call sites.
7. **Every AI structured output is parsed through a Zod schema** before it reaches the database. One retry with the error appended, then a typed error.
8. **Every model call writes a `usage_log` row**, including calls that fail after tokens were billed.

## Build order

Phases are a dependency chain: Generic Core → Universe System → Research Pipeline → Memory → Multiplayer → Validation & Gatekeeping → Turn Modes → Polish. Do not implement a later phase's work early.

Phase 1 is specified in `openspec/changes/phase-1-generic-core/`.

## Spec workflow

Work is proposed and specified before implementation.

```bash
openspec show <change>              # view
openspec status --change <change>   # artifact completion
openspec validate <change>          # must pass before implementing
openspec new change "<name>"        # scaffold
openspec archive <change>           # fold into openspec/specs/ when done
```

Spec format: requirements use SHALL/MUST, every requirement needs at least one scenario, and scenarios use **exactly four hashtags** (`#### Scenario:`) or they fail silently.

## Next.js 16 — not the Next.js you know

`apps/web/AGENTS.md` says this and it is not boilerplate. Read
`node_modules/next/dist/docs/` before writing app code. Confirmed differences:

- **`middleware.ts` is deprecated and renamed to `proxy.ts`.** Export a function
  named `proxy`. Ours lives at `apps/web/src/proxy.ts` and only refreshes the
  session — route-level authorization stays in `requireUser()`.
- **`cookies()` is async** — `await cookies()` before calling `.get()`/`.set()`.
- Always give `proxy` a `matcher`; without one it runs on static assets too.

## Verification

From `apps/web`: `npm test` (vitest), `npm run typecheck`, `npm run build`.
All three must pass. Tests are colocated as `src/**/*.test.ts`.

`server-only` is stubbed under vitest via an alias in `vitest.config.mts` —
the real guard still applies in builds. The config is `.mts`, not `.ts`, so
Vite's native loader does not warn about ESM-in-CJS.

## Gotchas

- **Docs are served at the site root** (`routeBasePath: '/'`), so doc links are `/architecture/turn-loop`, not `/docs/architecture/turn-loop`. There is no `src/pages/index.tsx` — the intro doc is the landing page.
- **MDX parses `{...}` as JSX.** Braces in prose need escaping or a code span. The `## Heading {#custom-id}` anchor syntax fails in `.md` here — rely on auto-generated slugs instead.
- **`onBrokenLinks: 'throw'`** — a bad internal link fails the docs build. That is deliberate.
- **PowerShell wraps node's stderr progress output** in NativeCommandError noise even on success. Check the actual exit code and trailing output before assuming a command failed.
- Both `docs` and `apps/web` default to port 3000.
- **Zod 4: `z.record(enum, v)` yields a fully-required `Record`**, and `ZodRecord`
  has no `.partial()`. For a partial map keyed by a fixed set, build a
  `z.object({...}).strict()` with optional values — see `src/lib/ai/roles.ts`.
- **No Docker or psql in this environment**, so `supabase start` (local stack)
  and `supabase db reset` cannot run here. Migrations are applied directly to
  the hosted project instead: `supabase link --project-ref <ref>`, then
  `supabase db push`. Run `supabase db advisors --linked` and
  `supabase db query --linked --file supabase/tests/rls_coverage.sql` after
  every migration to catch RLS/search_path gaps before trusting them.

## Deferred deliberately

Do not add these early "while you're in there":

- `chapters.embedding` and the `vector` extension — Phase 4
- `stories.universe_id` / `universe_version` — Phase 2
- `proposals`, `canon_exceptions` — Phase 6
- Inngest/Trigger.dev — Phase 3, where the research pipeline needs real orchestration. Phase 1 uses `extraction_queue` with stale-claim recovery.
