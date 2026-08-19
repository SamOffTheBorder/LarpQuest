import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireUser } from '@/lib/auth';
import { searchStory } from '@/lib/engine/search';
import { StoryNotFoundError, getStory } from '@/lib/engine/stories';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

/**
 * `ts_headline` marks matched terms with literal `<b>...</b>` around
 * otherwise-unescaped chapter/entity text — story content a player wrote,
 * not something we can trust as safe HTML. This splits on that fixed
 * delimiter and renders each piece as plain React text (auto-escaped),
 * re-inserting only a real `<b>` element for the matched spans, so no
 * story-authored text is ever interpreted as markup.
 */
function renderSnippet(snippet: string) {
  const parts = snippet.split(/(<b>|<\/b>)/);
  const nodes: React.ReactNode[] = [];
  let bolded = false;

  parts.forEach((part, index) => {
    if (part === '<b>') {
      bolded = true;
      return;
    }
    if (part === '</b>') {
      bolded = false;
      return;
    }
    nodes.push(
      bolded ? (
        <b key={index} className="font-semibold text-foreground">
          {part}
        </b>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      ),
    );
  });

  return nodes;
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ storyId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { storyId } = await params;
  const { q } = await searchParams;
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

  const query = q?.trim() ?? '';
  const results = query.length > 0 ? await searchStory(storyId, query) : [];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">{story.title} — Search</h1>
        <Link href={`/stories/${storyId}`} className={buttonVariants({ variant: 'outline' })}>
          Back to story
        </Link>
      </div>

      <form className="flex gap-2">
        <Input type="search" name="q" defaultValue={query} placeholder="Search chapters and entities…" autoFocus />
      </form>

      {query.length === 0 ? (
        <p className="text-sm text-muted-foreground">Search across this story&apos;s chapters and entities.</p>
      ) : results.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matches for &ldquo;{query}&rdquo;.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {results.map((result) => (
            <Card key={`${result.kind}-${result.id}`}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal uppercase text-muted-foreground">
                    {result.kind}
                  </span>
                  {result.kind === 'entity' ? (
                    <Link href={`/stories/${storyId}/entities/${result.id}`} className="hover:underline">
                      {result.title}
                    </Link>
                  ) : (
                    // Chapters render inline on the story dashboard — there is
                    // no dedicated per-chapter route to deep-link to.
                    <Link href={`/stories/${storyId}`} className="hover:underline">
                      {result.title}
                    </Link>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{renderSnippet(result.snippet)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
