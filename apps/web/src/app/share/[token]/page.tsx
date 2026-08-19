import { notFound } from 'next/navigation';

import { getSharedStoryView } from '@/lib/engine/share-links';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Public read-only share view. No `requireUser()` — this route is reached
 * by an unauthenticated visitor, by design (share-links spec, "without
 * requiring the visitor to authenticate"). No entity-sheet, submission, or
 * mutation UI exists anywhere on this page; getSharedStoryView's return
 * shape has no field that could render one.
 */
export default async function SharedStoryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getSharedStoryView(token);

  if (view === null) {
    notFound();
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{view.title}</h1>
        <p className="text-sm text-muted-foreground">Shared read-only view</p>
      </div>

      {view.chapters.length === 0 ? (
        <p className="text-sm text-muted-foreground">No chapters published yet.</p>
      ) : (
        [...view.chapters].reverse().map((chapter) => (
          <Card key={chapter.turnNumber}>
            <CardHeader>
              <CardTitle>Chapter {chapter.turnNumber}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {chapter.imageUrls.map((url) => (
                // eslint-disable-next-line @next/next/no-img-element -- external signed URL, not a local asset
                <img key={url} src={url} alt={`Chapter ${chapter.turnNumber} illustration`} className="w-full rounded-md" />
              ))}
              {chapter.videoUrls.map((url) => (
                <video key={url} src={url} controls className="w-full rounded-md" />
              ))}
              <p className="whitespace-pre-wrap text-sm">{chapter.prose}</p>
            </CardContent>
          </Card>
        ))
      )}
    </main>
  );
}
