import { Skeleton } from '@/components/ui/skeleton';

/**
 * Shown while the story page's server data resolves. The story view assembles
 * members, entities, and the current turn, so this is a visible wait rather
 * than a flash.
 */
export default function StoryLoading() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-2/3 max-w-sm" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
      <span className="sr-only">Loading story…</span>
    </main>
  );
}
