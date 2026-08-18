'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth';
import { getStory, updateStoryModelConfig } from '@/lib/engine/stories';

export type SettingsActionState = {
  status: 'idle' | 'error';
  message?: string;
};

const initialIdle: SettingsActionState = { status: 'idle' };

/**
 * Updates only the narrator and extractor model overrides — the two roles
 * Phase 1 actually calls. Reads the story's current model_config first so
 * other roles' overrides (none exist yet, but the schema allows them) are
 * preserved rather than dropped by a wholesale replace.
 */
export async function updateModelOverridesAction(
  storyId: string,
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await requireUser();

  const narrator = formData.get('narrator');
  const extractor = formData.get('extractor');

  try {
    const story = await getStory(storyId, user.id);

    const nextConfig = { ...story.modelConfig };

    if (typeof narrator === 'string' && narrator.trim().length > 0) {
      nextConfig.narrator = narrator.trim();
    } else {
      delete nextConfig.narrator;
    }

    if (typeof extractor === 'string' && extractor.trim().length > 0) {
      nextConfig.extractor = extractor.trim();
    } else {
      delete nextConfig.extractor;
    }

    await updateStoryModelConfig(storyId, user.id, nextConfig);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Something went wrong.';
    return { status: 'error', message };
  }

  revalidatePath(`/stories/${storyId}`);
  return initialIdle;
}
