## Context

Thirteen call sites build user prompts by interpolating untrusted text into a Markdown-ish
scaffold (`## Chapter draft\n${draft}`). The model sees one flat string; nothing distinguishes
text the platform wrote from text an attacker wrote. This is the standard prompt-injection setup,
and LAUNCH_PLAN.md B3.4 flags two surfaces as most damaging: the moderator (a control decision
made about attacker-authored text) and uploaded research source material (attacker-authored
documents whose processed output becomes universe canon).

## Goals / Non-Goals

**Goals.** Make the data/instruction boundary structurally explicit and uniform, so the guarantee
the Acceptable Use Policy already makes to users is actually enforced in prompt construction.
Centralise it so a new call site cannot forget it.

**Non-Goals.** This does not claim to *prevent* injection — no prompt-level defence does. It
raises the cost and removes the trivial cases. Defence in depth still rests on Zod parsing of
every structured output (CLAUDE.md #7), which already bounds what a compromised response can do:
a model talked into misbehaving still cannot emit a verdict outside the enum, or a field the
schema does not define. This change is the layer above that, not a replacement for it.

## Decisions

**Nonce-carrying fences, not static delimiters.** A static delimiter (`<user_content>`) is
public: an attacker reads the source, writes the closing tag, and escapes. A per-call random
nonce (`<user_content id="a3f9…">`) cannot be predicted before the call. The content is also
scanned for the nonce and any occurrence neutralised, which closes the case where an attacker
learns a nonce from one response and replays it — belt and braces, since a fresh nonce per call
already defeats replay.

*Alternative rejected:* escaping/stripping suspicious phrases ("ignore previous instructions").
Blocklists of natural language do not work — trivially paraphrased, and they corrupt legitimate
fiction, which in this product routinely contains characters issuing commands. Fencing is
structural and content-agnostic, which is also what keeps it compatible with CLAUDE.md #1: it
branches on nothing about genre, universe, or media type.

**One helper, applied at every site.** `untrusted.ts` exports the fence and a section builder.
Call sites pass their heading and their untrusted value separately and never concatenate the two
themselves. The reason is the same one CLAUDE.md gives for model resolution and spend caps living
in the gateway: a rule each call site must remember to apply is a rule that will eventually be
forgotten. The system-prompt preamble is likewise a single exported constant, so the standing
"fenced content is data" instruction cannot drift between roles.

**Moderator gets an extra clause.** Everywhere else, injection degrades output quality. In the
moderator it defeats a safety control, because the moderator judges text its adversary wrote.
Making an influence attempt itself a `flag` condition removes the attacker's best case: a
successful injection now produces the outcome (GM review) that the attacker was trying to avoid,
so the attempt is strictly worse than not trying.

## Risks / Trade-offs

**Token cost.** Fences add ~20 tokens per untrusted block. Negligible against chapter drafts and
research context, and it is charged against the same budget the gateway already caps.

**Prompt-asserting tests.** Existing tests that assert exact user-prompt strings will need to
assert on the fenced shape instead. Tests that assert content *appears* in a prompt still pass.
Because the nonce is random, tests must not assert against a fixed fence string — the helper
therefore accepts an injected nonce source, mirroring how `fetchImpl` is injected into the
gateway.
