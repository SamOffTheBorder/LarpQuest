import { describe, expect, it } from 'vitest';

import {
  effectiveContent,
  fromGenerated,
  isPinned,
  keptCast,
  premiseInputSchema,
  type GeneratedPremise,
} from '@/lib/engine/premise-schema';

/**
 * The premise schemas.
 *
 * Two invariants matter most here. An edit is stored *alongside* the
 * generated content rather than replacing it, so the model's original stays
 * recoverable. And the intent schema captures only open text and numbers —
 * there is no genre field for anything downstream to branch on.
 */

const validIntent = {
  pitch: 'A heist that goes wrong in the first ninety seconds.',
  contentRating: 'teen' as const,
};

const generated: GeneratedPremise = {
  title: 'The Long Fall',
  tldr: 'A crew takes one last job.',
  setting: 'A city built vertically, in perpetual rain.',
  openingSituation: 'The vault door closes early, with three of them inside.',
  cast: [
    { name: 'Vesper', type: 'character', role: 'fixer', description: 'Runs the crew.' },
    { name: 'Tan', type: 'character', role: 'infiltrator', description: 'Gets inside.' },
    { name: 'Ord', type: 'character', role: 'driver', description: 'Gets them out.' },
  ],
  hooks: ['Someone tipped off the arcology.'],
  toneGuidance: 'Wry and tense. Never grim for its own sake.',
};

describe('premiseInputSchema', () => {
  it('accepts a pitch alone and defaults the optional fields', () => {
    const parsed = premiseInputSchema.parse(validIntent);

    expect(parsed.pitch).toBe(validIntent.pitch);
    expect(parsed.settingSketch).toBe('');
    expect(parsed.castSize).toBe(3);
    expect(parsed.universeId).toBeNull();
  });

  it('accepts a setting sketch with no pitch', () => {
    const parsed = premiseInputSchema.parse({
      settingSketch: 'A generation ship that stopped accelerating.',
      contentRating: 'teen',
    });

    expect(parsed.settingSketch).toContain('generation ship');
  });

  it('rejects intent with neither a pitch nor a setting sketch', () => {
    const result = premiseInputSchema.safeParse({ contentRating: 'teen', toneNotes: 'bleak' });

    expect(result.success).toBe(false);
  });

  it('rejects a cast size outside the supported range', () => {
    expect(premiseInputSchema.safeParse({ ...validIntent, castSize: 0 }).success).toBe(false);
    expect(premiseInputSchema.safeParse({ ...validIntent, castSize: 9 }).success).toBe(false);
    expect(premiseInputSchema.safeParse({ ...validIntent, castSize: 8 }).success).toBe(true);
  });

  it('coerces a form-submitted cast size string', () => {
    expect(premiseInputSchema.parse({ ...validIntent, castSize: '5' }).castSize).toBe(5);
  });
});

describe('fromGenerated', () => {
  it('wraps every section as pending and keeps every cast member', () => {
    const document = fromGenerated(generated);

    expect(document.tldr.status).toBe('pending');
    expect(document.cast.status).toBe('pending');
    expect(document.cast.content.every((member) => member.kept)).toBe(true);
    expect(document.title).toBe('The Long Fall');
  });
});

describe('effectiveContent', () => {
  it('returns generated content when the section is untouched', () => {
    const document = fromGenerated(generated);

    expect(effectiveContent(document, 'tldr')).toBe('A crew takes one last job.');
  });

  it('prefers the edit while leaving the original recoverable', () => {
    const base = fromGenerated(generated);
    const document = {
      ...base,
      tldr: { status: 'edited' as const, content: base.tldr.content, editedContent: 'Mine now.' },
    };

    expect(effectiveContent(document, 'tldr')).toBe('Mine now.');
    expect(document.tldr.content).toBe('A crew takes one last job.');
  });
});

describe('isPinned', () => {
  it('treats accepted and edited as settled, pending and rejected as open', () => {
    expect(isPinned('accepted')).toBe(true);
    expect(isPinned('edited')).toBe(true);
    expect(isPinned('pending')).toBe(false);
    expect(isPinned('rejected')).toBe(false);
  });
});

describe('keptCast', () => {
  it('returns every member of an untouched cast', () => {
    expect(keptCast(fromGenerated(generated))).toHaveLength(3);
  });

  it('omits cut members while retaining them in the document', () => {
    const base = fromGenerated(generated);
    const cut = base.cast.content.map((member, index) =>
      index === 1 ? { ...member, kept: false } : member,
    );
    const document = {
      ...base,
      cast: { status: 'edited' as const, content: base.cast.content, editedContent: cut },
    };

    expect(keptCast(document).map((member) => member.name)).toEqual(['Vesper', 'Ord']);
    // Cut, not deleted — the cut stays reversible.
    expect(document.cast.editedContent).toHaveLength(3);
  });

  it('returns nothing when the whole cast section was rejected', () => {
    const base = fromGenerated(generated);
    const document = { ...base, cast: { ...base.cast, status: 'rejected' as const } };

    expect(keptCast(document)).toEqual([]);
  });
});
