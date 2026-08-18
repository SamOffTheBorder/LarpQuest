import { notFound } from 'next/navigation';
import Link from 'next/link';

import { requireUser } from '@/lib/auth';
import { generateBaseline } from '@/lib/engine/baseline';
import { StoryNotFoundError, getStory } from '@/lib/engine/stories';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Phase Exit Verification tool (task 10.4): regenerates the given turn using
 * only concatenated prior prose (no entity state, no world ledger) and shows
 * it next to the real, state-assembled chapter. Diagnostic only — visiting
 * this page calls the narrator model again and costs real money each time;
 * it does not persist anything or affect the story.
 */
export default async function BaselineComparisonPage({
  params,
}: {
  params: Promise<{ storyId: string; turnNumber: string }>;
}) {
  const { storyId, turnNumber: turnNumberParam } = await params;
  const user = await requireUser();

  const turnNumber = Number.parseInt(turnNumberParam, 10);

  if (!Number.isInteger(turnNumber) || turnNumber < 1) {
    notFound();
  }

  try {
    await getStory(storyId, user.id);
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      notFound();
    }
    throw error;
  }

  let comparison;
  try {
    comparison = await generateBaseline(storyId, user.id, turnNumber);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate baseline.';
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-6">
        <p className="text-sm text-destructive">{message}</p>
        <Link href={`/stories/${storyId}`} className={buttonVariants({ variant: 'outline' })}>
          Back to story
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          Baseline comparison — Chapter {comparison.turnNumber}
        </h1>
        <Link href={`/stories/${storyId}`} className={buttonVariants({ variant: 'outline' })}>
          Back to story
        </Link>
      </div>

      <p className="text-sm text-muted-foreground">
        The baseline was regenerated just now from raw prior-chapter prose only — no entity
        state, no world ledger. It costs real model spend each time this page loads and is not
        saved anywhere. Compare it against the real chapter for consistency: does the baseline
        forget or contradict established facts that the real chapter got right?
      </p>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Real chapter (state-assembled)</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm leading-relaxed">
            {comparison.realProse}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Baseline (prose-only, no state)</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm leading-relaxed">
            {comparison.baselineProse}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
