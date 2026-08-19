import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ExportButton } from '@/app/stories/[storyId]/export/export-button';
import { requireUser } from '@/lib/auth';
import { listExportJobs, type ExportFormat } from '@/lib/engine/export';
import { StoryNotFoundError, getStory } from '@/lib/engine/stories';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const FORMATS: ExportFormat[] = ['markdown', 'pdf', 'epub'];

const STATUS_VARIANT = {
  queued: 'secondary',
  complete: 'outline',
  failed: 'destructive',
} as const;

export default async function ExportPage({ params }: { params: Promise<{ storyId: string }> }) {
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

  const jobs = await listExportJobs(storyId, user.id);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">{story.title} — Export</h1>
        <Link href={`/stories/${storyId}`} className={buttonVariants({ variant: 'outline' })}>
          Back to story
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Export this story</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {FORMATS.map((format) => (
            <ExportButton key={format} storyId={storyId} format={format} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent exports</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No exports yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {jobs.map((job) => (
                <div key={job.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                  <span className="uppercase text-muted-foreground">{job.format}</span>
                  <Badge variant={STATUS_VARIANT[job.status]}>{job.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
