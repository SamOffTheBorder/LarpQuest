'use server';

import { redirect } from 'next/navigation';

import { requireUser } from '@/lib/auth';
import { createDraft } from '@/lib/research/drafts';
import { draftInputSchema } from '@/lib/research/schemas';

export type NewDraftState = {
  status: 'idle' | 'error';
  message?: string;
};

export async function createDraftAction(
  _prevState: NewDraftState,
  formData: FormData,
): Promise<NewDraftState> {
  const user = await requireUser();

  const sourceText = formData.get('sourceText');
  const canonCutoff = formData.get('canonCutoff');
  const auNotes = formData.get('auNotes');

  const parsed = draftInputSchema.safeParse({
    name: formData.get('name'),
    sourceText: typeof sourceText === 'string' && sourceText.trim().length > 0 ? sourceText : undefined,
    canonCutoff: typeof canonCutoff === 'string' && canonCutoff.trim().length > 0 ? canonCutoff : undefined,
    auNotes: typeof auNotes === 'string' && auNotes.trim().length > 0 ? auNotes : undefined,
  });

  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const draft = await createDraft(user.id, parsed.data);

  redirect(`/universes/${draft.id}/review`);
}
