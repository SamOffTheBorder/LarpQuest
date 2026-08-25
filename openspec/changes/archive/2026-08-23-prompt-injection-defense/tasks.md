## 1. The helper

- [x] 1.1 Added `lib/ai/untrusted.ts`: `fenceUntrusted(label, content, nonceSource?)`,
      `untrustedSections(parts, nonceSource?)`, `withUntrustedPreamble(systemPrompt)`,
      `newFenceNonce()`, and `UNTRUSTED_CONTENT_PREAMBLE`. Deliberately *not* `server-only` and
      not `node:crypto`: the prompt builders that consume it (`turn-modes`, `research/prompts`,
      `memory/prompts`, `extractor`, `context`) are pure modules with no server-only dependency,
      and `context.ts` in particular is a pure function by design. Uses
      `crypto.getRandomValues`, available in every runtime this code runs in.
- [x] 1.2 Added `untrusted.test.ts` (8 cases): fence shape, nonce-per-call, self-close
      neutralisation, injected nonce source, empty/multiline content, forged-heading
      containment, preamble wording.

## 2. The two surfaces the launch plan names

- [x] 2.1 `moderation/moderate.ts`: each submission fenced via `untrustedSections`; content
      rating left as trusted scaffolding. System prompt gained the standing preamble plus a
      moderator-specific clause making an influence attempt itself grounds to `flag` and barring
      the reason string from echoing instructions back.
- [x] 2.2 `research/prompts.ts`: `inputContext` now fences `sourceText`, `auNotes`, `name`, and
      `canonCutoff` — all user-supplied. All 11 upstream stage-output interpolations fenced too
      (stage output is derived from the same untrusted input). All seven stage system prompts
      wrapped with the preamble.

## 3. Remaining call sites

- [x] 3.1 `ai/validator-call.ts` (chapter draft, entities fenced; rules left trusted) and
      `engine/gatekeeper.ts` (proposal, universe rules, entity JSON fenced; progression model
      trusted). The gatekeeper also rules on text its adversary wrote, so it received an
      influence-attempt clause of its own alongside the preamble.
- [x] 3.2 `engine/context.ts` — the narrator's prompt, and the largest untrusted surface: story
      title, tone, canon bible, entity state, world ledger, scene setup, player actions, recent
      chapters, and retrieved history are all fenced; headers, the mode line, and the constraints
      block stay bare so the model can still read the prompt's structure.
      `engine/turn-modes.ts` appends the preamble once in the shared `policyAndRulingLines`, so
      all six modes get it with no per-mode branch. Also `engine/baseline.ts`,
      `engine/extractor.ts` (+ an extraction-specific clause, since extraction writes canonical
      state), `engine/universes.ts`, `engine/image-prompts.ts`.
- [x] 3.3 `memory/prompts.ts` (chapter prose, entity list, per-chapter arc summaries fenced;
      both system prompts wrapped). `memory/arc-compaction.ts`, `memory/generate.ts`,
      `research/pipeline.ts`, and both inngest functions are pass-throughs — they carry prompts
      built by the modules above and needed no change.
- [x] 3.4 **Found during audit, not in the original plan:** `ai/gateway.ts`'s structured-output
      retry appended the rejected response unfenced. That response is model output that may
      itself have been steered by injected content in the original prompt, so it is now fenced
      like any other untrusted text.

## 4. Verification

- [x] 4.1 No test asserted an exact whole-prompt string, so none needed rewriting. Three
      `context.test.ts` determinism tests did fail — correctly: they caught that a random nonce
      inside `assembleContext` would break its documented purity. Resolved by making the nonce an
      *input* (`AssembleContextInput.fenceNonce`), with the turn loop passing a fresh
      `newFenceNonce()` per generation. Purity preserved, unpredictability preserved where it
      matters: the fence around a given call's content.
- [x] 4.2 Added injection-resistance cases per named surface — `moderate.test.ts` (+6:
      fencing, scaffolding forgery contained, fence-close neutralised, both system-prompt
      clauses), new `research/prompts.test.ts` (7: source-material fencing, hidden directive
      contained, self-close, stage-output fencing, preamble, fresh nonce), `context.test.ts` (+5:
      all sections fenced, scaffolding bare, forged heading contained, fence-close, purity), and
      a retry-fencing assertion in `gateway.test.ts`.
- [x] 4.3 `npm test` (539 passed, +18 from this change), `npm run typecheck`, `npm run build` in
      `apps/web` — all three clean.
- [x] 4.4 Recorded B3.4 in LAUNCH_PLAN.md's `## Completed` section.
