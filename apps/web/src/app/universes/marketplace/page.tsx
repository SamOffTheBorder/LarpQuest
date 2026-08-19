import Link from 'next/link';

import { CloneButton } from '@/app/universes/marketplace/clone-button';
import { requireUser } from '@/lib/auth';
import { listPublicUniverses } from '@/lib/engine/marketplace';
import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default async function MarketplacePage() {
  await requireUser();

  const universes = await listPublicUniverses();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">Universe Marketplace</h1>
        <Link href="/stories" className={buttonVariants({ variant: 'outline' })}>
          Back to stories
        </Link>
      </div>

      {universes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No public universes yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {universes.map((universe) => (
            <Card key={universe.id}>
              <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  {universe.name}
                  {universe.forkedFrom !== null && <Badge variant="secondary">fork</Badge>}
                </CardTitle>
                <CloneButton universeId={universe.id} />
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Published {new Date(universe.createdAt).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
