# StoryForge — Future Ideas / Experiments

Not part of `STORYFORGE_BUILD_PLAN.md` and not scheduled into a phase. Speculative
capabilities to explore once the 8 shipped phases have real usage. Nothing here
is authorized for implementation until it goes through the normal openspec
propose → validate → implement flow.

## Read-aloud narration with synced text highlighting

Reference: paper2audio.com's reading experience — text-to-speech narration of
a chapter with the currently-spoken word/sentence highlighted in sync on
screen, plus user controls for highlight color and reading speed.

For StoryForge this would apply to published chapter prose (and potentially
dialogue-only playback, see below).

Open questions before this could be scoped as a change:
- TTS provider selection (would need a new model role, per CLAUDE.md rule 6 —
  no hardcoded model strings at call sites)
- Where sync timing data comes from (word-level timestamps from the TTS
  provider vs. estimated pacing)
- Cost/usage implications — narrating every chapter adds a per-chapter TTS
  cost on top of existing narrator/extractor spend; needs to respect the
  existing `usage_log` discipline (rule 8)

## Per-character voices in narration

Idea: when a chapter is read aloud, each character's dialogue plays in a
distinct voice rather than one flat narrator voice for everything.

Two voice sources, both wanted:

1. **Preset voice picker per character** — smaller scope. Player or DM picks
   a voice from a library of TTS preset voices for their character (or an
   NPC). No recording, no cloning, no consent/biometric handling.

2. **Voice cloning from a player-recorded sample** — larger scope. A player
   records or uploads a short voice sample; the app synthesizes a cloned
   voice for their character's dialogue, with player-adjustable options for
   how the synthesized voice should sound (pitch, tone, etc. — exact knobs
   depend on the cloning provider's API). Requires:
   - An explicit consent/opt-in flow before storing or using a voice sample
     (this is biometric-adjacent data)
   - A voice-cloning provider integration (new model role)
   - Storage for voice samples/cloned-voice references, RLS-gated like every
     other table (rule 5)

**NPC voices are DM-assigned** — the DM chooses which preset voice (or,
later, which cloned/synthesized voice) an NPC uses when it speaks. This
keeps voice assignment out of engine logic entirely — it is data on the
entity/character record, not a branch in narration code, consistent with
rule 1 (no conditionals on genre/universe/media type — and by extension, no
hardcoded voice logic in the engine).

Needs its own attribution/mapping problem solved first: chapter prose today
is undifferentiated narrator text (see `chapters.prose`) — splitting it into
per-speaker segments for playback is a real parsing/extraction problem, not
just a TTS wiring problem.
