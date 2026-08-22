import { notFound } from 'next/navigation';
import Link from 'next/link';

import { requireUser } from '@/lib/auth';
import { listChapters } from '@/lib/engine/chapters';
import { listEntities } from '@/lib/engine/entities';
import { isOwner } from '@/lib/engine/membership';
import { StoryNotFoundError, getStory } from '@/lib/engine/stories';
import { getLiveTurn, listSubmissionsForTurn } from '@/lib/engine/turns';
import { getStoryCostUsd } from '@/lib/engine/usage-summary';
import { ArchiveButton } from '@/app/stories/[storyId]/archive-button';
import { ModelSettings } from '@/app/stories/[storyId]/model-settings';
import { ReportChapterButton } from '@/app/stories/[storyId]/report-chapter-button';
import { RollbackButton } from '@/app/stories/[storyId]/rollback-button';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { TurnPanel } from '@/app/stories/[storyId]/turn-panel';

export default async function StoryPage({
  params,
}: {
  params: Promise<{ storyId: string }>;
}) {
  const { storyId } = await params;
  const user = await requireUser();

  let story;
  try {
    story = await getStory(storyId, user.id);
  } catch (error) {
    if (error instanceof StoryNotFoundError) {
      notFound();
    }
    throw error;
  }

  const [chapters, liveTurn, costUsd, owner, entities] = await Promise.all([
    listChapters(storyId, user.id),
    getLiveTurn(storyId, user.id),
    getStoryCostUsd(storyId, user.id),
    isOwner(storyId, user.id),
    listEntities(storyId, user.id),
  ]);

  const claimedEntityIds = entities
    .filter((entity) => entity.controlledBy !== null)
    .map((entity) => entity.id);

  const submissions =
    liveTurn !== null ? await listSubmissionsForTurn(liveTurn.id, user.id) : [];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold sm:text-2xl">{story.title}</h1>
            {story.status === 'archived' && <Badge variant="secondary">Archived</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            Turn {story.currentTurn} &middot; ${costUsd.toFixed(4)} spent
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <Link href={`/stories/${storyId}/search`} className={buttonVariants({ variant: 'outline' })}>
            Search
          </Link>
          <Link href={`/stories/${storyId}/export`} className={buttonVariants({ variant: 'outline' })}>
            Export
          </Link>
          <Link href={`/stories/${storyId}/entities`} className={buttonVariants({ variant: 'outline' })}>
            Entities
          </Link>
          <Link href={`/stories/${storyId}/members`} className={buttonVariants({ variant: 'outline' })}>
            Members
          </Link>
          <Link href={`/stories/${storyId}/consistency`} className={buttonVariants({ variant: 'outline' })}>
            Consistency
          </Link>
          <Link href="/stories" className={buttonVariants({ variant: 'outline' })}>
            All stories
          </Link>
          {owner && <ArchiveButton storyId={storyId} archived={story.status === 'archived'} />}
        </div>
      </div>

      {owner && (
        <ModelSettings
          storyId={storyId}
          narrator={story.modelConfig.narrator}
          extractor={story.modelConfig.extractor}
        />
      )}

      <TurnPanel
        storyId={storyId}
        story={story}
        turn={liveTurn}
        submissions={submissions}
        userId={user.id}
        claimedEntityIds={claimedEntityIds}
      />

      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Chapters</h2>
        {chapters.length === 0 ? (
          <p className="text-muted-foreground">No chapters published yet.</p>
        ) : (
          [...chapters].reverse().map((chapter) => (
            <Card key={chapter.id}>
              <CardHeader className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>Chapter {chapter.turnNumber}</CardTitle>
                  {chapter.rolledBackAt !== null && <Badge variant="secondary">Rolled back</Badge>}
                  {chapter.extractionStatus === 'pending' ? (
                    <Badge variant="secondary">State update pending</Badge>
                  ) : chapter.extractionStatus === 'failed' ? (
                    <Badge variant="destructive">Extraction failed — retrying</Badge>
                  ) : null}
                </div>
                {owner && chapter.rolledBackAt === null && (
                  <RollbackButton storyId={storyId} chapterId={chapter.id} />
                )}
              </CardHeader>
              <CardContent className="whitespace-pre-wrap font-serif text-sm leading-relaxed">
                {chapter.prose}
              </CardContent>
              <CardFooter className="flex-col items-start gap-2">
                <ReportChapterButton chapterId={chapter.id} />
              </CardFooter>
              {owner && (
                <CardFooter>
                  <Link
                    href={`/stories/${storyId}/baseline/${chapter.turnNumber}`}
                    className="text-xs text-muted-foreground underline"
                  >
                    Compare to no-state baseline (costs model spend)
                  </Link>
                </CardFooter>
              )}
            </Card>
          ))
        )}
      </div>
    </main>
  );
}
