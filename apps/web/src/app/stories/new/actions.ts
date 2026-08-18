'use server';

import { redirect } from 'next/navigation';

import { requireUser } from '@/lib/auth';
import { createStoryInputSchema, createStory } from '@/lib/engine/stories';

export type CreateStoryState = {
  status: 'idle' | 'error';
  message?: string;
};

export async function createStoryAction(
  _prevState: CreateStoryState,
  formData: FormData,
): Promise<CreateStoryState> {
  const user = await requireUser();

  const universeId = formData.get('universeId');

  const parsed = createStoryInputSchema.safeParse({
    title: formData.get('title'),
    contentRating: formData.get('contentRating'),
    universeId: typeof universeId === 'string' && universeId.length > 0 ? universeId : null,
  });

  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const story = await createStory(user.id, parsed.data);

  redirect(`/stories/${story.id}`);
}
