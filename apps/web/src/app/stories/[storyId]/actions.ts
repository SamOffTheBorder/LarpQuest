'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth';
import { createSubmission, openTurn, submissionInputSchema, updateSubmission } from '@/lib/engine/turns';

export type TurnActionState = {
  status: 'idle' | 'error';
  message?: string;
};

const initialIdle: TurnActionState = { status: 'idle' };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export async function openTurnAction(storyId: string): Promise<TurnActionState> {
  const user = await requireUser();

  try {
    await openTurn(storyId, user.id);
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  revalidatePath(`/stories/${storyId}`);
  return initialIdle;
}

export async function submitAction(
  storyId: string,
  turnId: string,
  _prevState: TurnActionState,
  formData: FormData,
): Promise<TurnActionState> {
  const user = await requireUser();

  const parsed = submissionInputSchema.safeParse({
    content: formData.get('content'),
    entityId: formData.get('entityId') || null,
  });

  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid submission.' };
  }

  const existingId = formData.get('submissionId');

  try {
    if (typeof existingId === 'string' && existingId.length > 0) {
      await updateSubmission(existingId, user.id, parsed.data);
    } else {
      await createSubmission(turnId, user.id, parsed.data);
    }
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  revalidatePath(`/stories/${storyId}`);
  return initialIdle;
}

// Lock-and-generate and retry now stream through
// `stories/[storyId]/turns/[turnId]/generate/route.ts` (Server-Sent Events),
// so the browser sees prose as it arrives instead of a static "writing…"
// message with no feedback until the whole thing lands. Kept as a route
// handler rather than a Server Action because streaming a live response body
// back to the client isn't representable through the Server Action return
// value.
