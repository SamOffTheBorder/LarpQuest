import { untrustedSections, withUntrustedPreamble, type NonceSource, type PromptSection } from '@/lib/ai/untrusted';
import {
  effectiveContent,
  isPinned,
  type PremiseDocument,
  type PremiseInput,
} from '@/lib/engine/premise-schema';

/**
 * Premise prompts.
 *
 * Pure string building, no server dependency, so this is unit-testable
 * without touching the gateway.
 *
 * Nothing here names a genre, a franchise, or a media type. The GM's own
 * words carry whatever genre they intend, and they arrive fenced as untrusted
 * content — so the model reads them as material to work from, never as
 * direction about how to behave (CLAUDE.md constraint #1 and the prompt-safety
 * spec both apply).
 */

const RATING_GUIDANCE: Record<string, string> = {
  everyone: 'Keep all content suitable for a general audience of any age.',
  teen: 'Content may include peril, conflict, and mild language, at roughly a teen rating.',
  mature: 'Mature themes are permitted, but avoid gratuitous or explicit content.',
};

function ratingInstruction(contentRating: string): string {
  return (
    RATING_GUIDANCE[contentRating] ??
    'Keep content suitable for a general audience.'
  );
}

const SYSTEM_PROMPT_BODY = [
  'You are helping a game master start a new collaborative story. Write a',
  'premise they can begin playing immediately: concrete, specific, and open',
  'enough that other players can act inside it.',
  '',
  'Produce:',
  '- title: a short, evocative title for the story.',
  '- tldr: two or three sentences a player could read to know what this story is.',
  '- setting: where and when this takes place, and what makes it distinct.',
  '- openingSituation: the specific unresolved situation the first turn opens on.',
  '  Something is already happening — do not open on a calm scene awaiting a plot.',
  '- cast: the starting characters. For each, give a name, a short free-text',
  '  type describing what kind of thing it is, the role it plays in the story,',
  '  and a description. Choose types that suit this story; there is no fixed',
  '  list to pick from.',
  '- hooks: unresolved threads the story can pull on later.',
  '- toneGuidance: how this story should feel, and what would break that feeling.',
  '',
  'Write for the story the game master actually described. Do not smooth it',
  'toward a more familiar premise, and do not add a chosen-one framing unless',
  'they asked for one.',
  '',
  'Respond with JSON only, matching the required schema exactly.',
].join('\n');

export function premiseSystemPrompt(contentRating: string): string {
  return withUntrustedPreamble(
    [SYSTEM_PROMPT_BODY, '', `Content rating: ${ratingInstruction(contentRating)}`].join('\n'),
  );
}

/**
 * Every field is GM-authored free text, so all of it is fenced. `castSize` is
 * a number we validated, so it is trusted scaffolding rather than a fence.
 */
function intentSections(input: PremiseInput): PromptSection[] {
  const sections: PromptSection[] = [];

  if (input.pitch.length > 0) {
    sections.push({ heading: 'What the game master wants', untrusted: input.pitch });
  }
  if (input.settingSketch.length > 0) {
    sections.push({ heading: 'Setting sketch', untrusted: input.settingSketch });
  }
  if (input.toneNotes.length > 0) {
    sections.push({ heading: 'Tone notes', untrusted: input.toneNotes });
  }
  if (input.mustInclude.length > 0) {
    sections.push({ heading: 'Must include', untrusted: input.mustInclude });
  }
  if (input.mustAvoid.length > 0) {
    sections.push({ heading: 'Must avoid', untrusted: input.mustAvoid });
  }

  sections.push({
    heading: 'Cast size',
    trusted: `Propose ${input.castSize} starting cast ${input.castSize === 1 ? 'member' : 'members'}.`,
  });

  return sections;
}

/** First generation: intent only, plus optional universe canon. */
export function buildPremisePrompt(
  input: PremiseInput,
  canonContext: string | null = null,
  nonceSource?: NonceSource,
): string {
  const sections = intentSections(input);

  if (canonContext !== null && canonContext.length > 0) {
    sections.push({
      heading: 'Established canon this story must sit inside',
      untrusted: canonContext,
    });
  }

  return untrustedSections(sections, nonceSource);
}

/**
 * Render the sections the owner has settled as fixed constraints.
 *
 * This is half of the pin mechanism (design.md decision 3). The prompt
 * constraint is what makes *regenerated* sections coherent with the kept ones
 * — a new opening situation that ignored the kept cast would be useless. The
 * other half, the unconditional merge in `premise.ts`, is what guarantees the
 * kept content survives byte-identical even if the model rewrites it anyway.
 *
 * Cut cast members are omitted: the owner rejected them, so reproposing them
 * as settled would be exactly wrong.
 */
function pinnedSections(document: PremiseDocument): PromptSection[] {
  const sections: PromptSection[] = [];

  if (isPinned(document.tldr.status)) {
    sections.push({ heading: 'Settled — TLDR', untrusted: effectiveContent(document, 'tldr') });
  }
  if (isPinned(document.setting.status)) {
    sections.push({ heading: 'Settled — setting', untrusted: effectiveContent(document, 'setting') });
  }
  if (isPinned(document.openingSituation.status)) {
    sections.push({
      heading: 'Settled — opening situation',
      untrusted: effectiveContent(document, 'openingSituation'),
    });
  }
  if (isPinned(document.cast.status)) {
    const kept = effectiveContent(document, 'cast').filter((member) => member.kept);
    if (kept.length > 0) {
      sections.push({
        heading: 'Settled — cast',
        untrusted: kept
          .map((member) => `${member.name} (${member.type}, ${member.role}): ${member.description}`)
          .join('\n'),
      });
    }
  }
  if (isPinned(document.hooks.status)) {
    sections.push({
      heading: 'Settled — hooks',
      untrusted: effectiveContent(document, 'hooks').join('\n'),
    });
  }
  if (isPinned(document.toneGuidance.status)) {
    sections.push({
      heading: 'Settled — tone guidance',
      untrusted: effectiveContent(document, 'toneGuidance'),
    });
  }

  return sections;
}

/**
 * Regeneration: the original intent, the settled sections as constraints, the
 * sections being replaced, and the owner's notes.
 *
 * The model is still asked for a complete document — asking for a partial one
 * invites it to restate the pinned sections badly, and the merge discards its
 * versions of them regardless.
 */
export function buildRegeneratePrompt(
  input: PremiseInput,
  document: PremiseDocument,
  regenerating: readonly string[],
  notes: string,
  canonContext: string | null = null,
  nonceSource?: NonceSource,
): string {
  const sections = intentSections(input);
  const pins = pinnedSections(document);

  if (pins.length > 0) {
    sections.push({
      heading: 'Settled parts',
      trusted: [
        'The game master has approved the parts below. Reproduce them exactly',
        'as given and write everything else so it fits with them.',
      ].join(' '),
    });
    sections.push(...pins);
  }

  sections.push({
    heading: 'Rewrite these',
    trusted: [
      `Replace the following with fresh alternatives: ${regenerating.join(', ')}.`,
      'The game master rejected the previous versions, so do not restate them.',
    ].join(' '),
  });

  if (notes.trim().length > 0) {
    sections.push({ heading: 'What the game master said about the last draft', untrusted: notes });
  }

  if (canonContext !== null && canonContext.length > 0) {
    sections.push({
      heading: 'Established canon this story must sit inside',
      untrusted: canonContext,
    });
  }

  return untrustedSections(sections, nonceSource);
}
