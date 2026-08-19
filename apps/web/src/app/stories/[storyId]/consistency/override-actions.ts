'use server';

import { requireUser } from '@/lib/auth';
import { overrideProposal, overrideValidationFlag } from '@/lib/engine/canon-exceptions';

export type OverrideActionState = {
  status: 'idle' | 'error' | 'success';
  message?: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export async function overrideValidationFlagAction(
  chapterId: string,
  ruleId: string,
  entityId: string | null,
  capabilityId: string | null,
  _prevState: OverrideActionState,
  formData: FormData,
): Promise<OverrideActionState> {
  const user = await requireUser();

  const note = formData.get('exceptionNote');
  if (typeof note !== 'string' || note.trim().length === 0) {
    return { status: 'error', message: 'A reason is required.' };
  }

  try {
    await overrideValidationFlag(chapterId, user.id, ruleId, { entityId, capabilityId }, note);
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  return { status: 'success' };
}

export async function overrideProposalAction(
  proposalId: string,
  _prevState: OverrideActionState,
  formData: FormData,
): Promise<OverrideActionState> {
  const user = await requireUser();

  const note = formData.get('exceptionNote');
  if (typeof note !== 'string' || note.trim().length === 0) {
    return { status: 'error', message: 'A reason is required.' };
  }

  try {
    await overrideProposal(proposalId, user.id, note);
  } catch (error) {
    return { status: 'error', message: errorMessage(error) };
  }

  return { status: 'success' };
}
