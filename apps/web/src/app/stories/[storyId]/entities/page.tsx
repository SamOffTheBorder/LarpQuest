import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireUser } from '@/lib/auth';
import { listEntities } from '@/lib/engine/entities';
import { StoryNotFoundError, getStory } from '@/lib/engine/stories';
import { getUniverseVersion } from '@/lib/engine/universes';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ClaimButton } from '@/app/stories/[storyId]/entities/claim-button';
import { NewEntityForm } from '@/app/stories/[storyId]/entities/new-entity-form';
import { NewSchemaEntityForm } from '@/app/stories/[storyId]/entities/entity-fields/new-schema-entity-form';

export default async function EntitiesPage({
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

  const entities = await listEntities(storyId, user.id);

  // A pinned universe gets the dynamic schema-driven form, one per entity
  // type; an unpinned (Phase 1) story keeps the freeform type+data form.
  const universeVersion =
    story.universeId !== null && story.universeVersion !== null
      ? await getUniverseVersion(story.universeId, story.universeVersion)
      : null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">Entities</h1>
        <Link href={`/stories/${storyId}`} className={buttonVariants({ variant: 'outline' })}>
          Back to story
        </Link>
      </div>

      {universeVersion !== null ? (
        Object.keys(universeVersion.entitySchema.entity_types).map((entityType) => (
          <NewSchemaEntityForm
            key={entityType}
            storyId={storyId}
            entitySchema={universeVersion.entitySchema}
            entityType={entityType}
          />
        ))
      ) : (
        <NewEntityForm storyId={storyId} />
      )}

      <div className="flex flex-col gap-3">
        {entities.length === 0 ? (
          <p className="text-muted-foreground">No entities yet.</p>
        ) : (
          entities.map((entity) => (
            <Link key={entity.id} href={`/stories/${storyId}/entities/${entity.id}`}>
              <Card className="transition-colors hover:bg-muted/50">
                <CardHeader className="flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle>{entity.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">{entity.type}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {entity.status !== 'active' && <Badge variant="secondary">{entity.status}</Badge>}
                    <ClaimButton
                      storyId={storyId}
                      entityId={entity.id}
                      controlledBy={entity.controlledBy}
                      currentUserId={user.id}
                    />
                  </div>
                </CardHeader>
              </Card>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}
