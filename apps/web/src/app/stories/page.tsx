import Link from 'next/link';

import { requireUser } from '@/lib/auth';
import { listStories } from '@/lib/engine/stories';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';

export default async function StoriesPage() {
  const user = await requireUser();
  const stories = await listStories(user.id);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your stories</h1>
        <Link href="/stories/new" className={buttonVariants()}>
          New story
        </Link>
      </div>

      {stories.length === 0 ? (
        <p className="text-muted-foreground">
          No stories yet. <Link href="/stories/new" className="underline">Start one</Link>.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {stories.map((story) => (
            <Link key={story.id} href={`/stories/${story.id}`}>
              <Card className="transition-colors hover:bg-muted/50">
                <CardHeader className="flex-row items-center justify-between">
                  <div>
                    <CardTitle>{story.title}</CardTitle>
                    <p className="text-sm text-muted-foreground">Turn {story.currentTurn}</p>
                  </div>
                  {story.status === 'archived' && <Badge variant="secondary">Archived</Badge>}
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
