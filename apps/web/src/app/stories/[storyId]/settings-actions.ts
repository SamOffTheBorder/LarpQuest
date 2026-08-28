'use server';

import { revalidatePath } from 'next/cache';

import { CONFIGURABLE_TEXT_ROLES } from '@/lib/ai/roles';
import { requireUser } from '@/lib/auth';
import { getStory, updateStoryModelConfig } from '@/lib/engine/stories';

export type SettingsActionState = {
  status: 'idle' | 'error';
  message?: string;
};

const initialIdle: SettingsActionState = { status: 'idle' };

/**
 * Updates the per-role model overrides for every configurable text role.
 * Reads the story's current model_config first, then for each role sets the
 * trimmed value or deletes the entry when blank, so a role left on "Project
 * default" falls back to DEFAULT_MODELS. The whole map is re-validated through
 * `modelConfigSchema` inside `updateStoryModelConfig`.
 */
export async function updateModelOverridesAction(
  storyId: string,
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await requireUser();

  try {
    const story = await getStory(storyId, user.id);

    const nextConfig = { ...story.modelConfig };

    for (const role of CONFIGURABLE_TEXT_ROLES) {
      const value = formData.get(role);
      if (typeof value === 'string' && value.trim().length > 0) {
        nextConfig[role] = value.trim();
      } else {
        delete nextConfig[role];
      }
    }

    await updateStoryModelConfig(storyId, user.id, nextConfig);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Something went wrong.';
    return { status: 'error', message };
  }

  revalidatePath(`/stories/${storyId}`);
  return initialIdle;
}
