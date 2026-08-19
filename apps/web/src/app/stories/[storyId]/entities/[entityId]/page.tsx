import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireUser } from '@/lib/auth';
import { EntityNotFoundError, getEntity } from '@/lib/engine/entities';
import { getStory } from '@/lib/engine/stories';
import { getUniverseVersion } from '@/lib/engine/universes';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EditFieldForm } from '@/app/stories/[storyId]/entities/[entityId]/edit-field-form';
import { EditSchemaEntityForm } from '@/app/stories/[storyId]/entities/entity-fields/edit-schema-entity-form';

export default async function EntityPage({
  params,
}: {
  params: Promise<{ storyId: string; entityId: string }>;
}) {
  const { storyId, entityId } = await params;
  const user = await requireUser();

  let entity;
  try {
    entity = await getEntity(entityId, user.id);
  } catch (error) {
    if (error instanceof EntityNotFoundError) {
      notFound();
    }
    throw error;
  }

  if (entity.storyId !== storyId) {
    notFound();
  }

  const story = await getStory(storyId, user.id);
  const universeVersion =
    story.universeId !== null && story.universeVersion !== null
      ? await getUniverseVersion(story.universeId, story.universeVersion)
      : null;

  const fields = Object.entries(entity.data);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">{entity.name}</h1>
          <p className="text-sm text-muted-foreground">{entity.type}</p>
        </div>
        <Link href={`/stories/${storyId}/entities`} className={buttonVariants({ variant: 'outline' })}>
          Back to entities
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current state</CardTitle>
        </CardHeader>
        <CardContent>
          {fields.length === 0 ? (
            <p className="text-muted-foreground">No fields yet. Add one below.</p>
          ) : (
            <dl className="flex flex-col gap-2">
              {fields.map(([field, value]) => (
                <div key={field} className="flex flex-col gap-1 border-b pb-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                  <dt className="font-mono text-sm text-muted-foreground">{field}</dt>
                  <dd className="text-sm break-words">{JSON.stringify(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>

      {universeVersion !== null ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Edit</CardTitle>
          </CardHeader>
          <CardContent>
            <EditSchemaEntityForm
              storyId={storyId}
              entityId={entityId}
              entitySchema={universeVersion.entitySchema}
              entityType={entity.type}
              data={entity.data}
            />
          </CardContent>
        </Card>
      ) : (
        <EditFieldForm storyId={storyId} entityId={entityId} />
      )}
    </main>
  );
}
