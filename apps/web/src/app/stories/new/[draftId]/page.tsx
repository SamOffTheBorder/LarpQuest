import { notFound, redirect } from 'next/navigation';

import { SectionReview } from '@/app/stories/new/[draftId]/premise-review';
import {
  ApproveButton,
  NotesForm,
  RegenerateButton,
  RetryGenerateButton,
} from '@/app/stories/new/[draftId]/review-controls';
import { requireUser } from '@/lib/auth';
import { getPremiseDraft, PremiseDraftNotFoundError } from '@/lib/engine/premise-drafts';
import { isPinned, PREMISE_SECTION_KEYS, type PremiseSectionKey } from '@/lib/engine/premise-schema';

/**
 * Story creation, step two: review the premise.
 *
 * A non-owner and a nonexistent draft both 404 — the draft module already
 * makes them indistinguishable, and this only has to not undo that.
 */

const SECTION_LABELS: Record<PremiseSectionKey, { label: string; description: string }> = {
  tldr: { label: 'The pitch', description: 'What this story is, in a few sentences.' },
  setting: { label: 'Setting', description: 'Where and when, and what makes it distinct.' },
  openingSituation: {
    label: 'Opening situation',
    description: 'What is already happening when turn 1 begins.',
  },
  cast: { label: 'Starting cast', description: 'Created as entities when you start the story.' },
  hooks: { label: 'Hooks', description: 'Threads the story can pull on later.' },
  toneGuidance: { label: 'Tone', description: 'How this should feel — and what would break it.' },
};

export default async function PremiseReviewPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  const user = await requireUser();

  let draft;
  try {
    draft = await getPremiseDraft(draftId, user.id);
  } catch (error) {
    if (error instanceof PremiseDraftNotFoundError) {
      notFound();
    }
    throw error;
  }

  // Already approved — the story exists, so send the GM to it rather than
  // letting them approve a second one from the same draft.
  if (draft.status === 'approved' && draft.storyId !== null) {
    redirect(`/stories/${draft.storyId}`);
  }

  if (draft.premise === null) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-6">
        <div>
          <h1 className="text-xl font-semibold">That didn&apos;t generate</h1>
          <p className="text-sm text-muted-foreground">
            Your description was saved, so nothing is lost — this just needs another go.
          </p>
        </div>
        <RetryGenerateButton draftId={draftId} />
      </main>
    );
  }

  const premise = draft.premise;
  const everythingKept = PREMISE_SECTION_KEYS.every((key) => isPinned(premise[key].status));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{premise.title}</h1>
        <p className="text-sm text-muted-foreground">
          Keep what works, cut what doesn&apos;t, then re-roll. Anything you keep stays exactly
          as it is.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {PREMISE_SECTION_KEYS.map((key) => (
          <SectionReview
            key={key}
            draftId={draftId}
            sectionKey={key}
            label={SECTION_LABELS[key].label}
            description={SECTION_LABELS[key].description}
            document={premise}
          />
        ))}
      </div>

      <div className="flex flex-col gap-4 border-t pt-4">
        <NotesForm draftId={draftId} notes={draft.notes} />
        <div className="flex flex-wrap items-start gap-3">
          <RegenerateButton draftId={draftId} everythingKept={everythingKept} />
          <ApproveButton draftId={draftId} />
        </div>
      </div>
    </main>
  );
}
