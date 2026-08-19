import Link from 'next/link';
import { redirect } from 'next/navigation';

import { requireUser } from '@/lib/auth';
import { InvalidInviteError, joinViaInvite } from '@/lib/engine/invites';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const REASON_MESSAGES: Record<InvalidInviteError['reason'], string> = {
  invite_not_found: 'This invite link is not valid.',
  invite_revoked: 'This invite has been revoked by the story owner.',
  invite_expired: 'This invite has expired.',
  invite_exhausted: 'This invite has already been used the maximum number of times.',
};

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  await requireUser();

  try {
    const result = await joinViaInvite(token);
    redirect(`/stories/${result.storyId}`);
  } catch (error) {
    // redirect() throws internally to interrupt rendering; let that propagate.
    if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT')) {
      throw error;
    }

    const message =
      error instanceof InvalidInviteError
        ? REASON_MESSAGES[error.reason]
        : 'Something went wrong joining this story.';

    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 p-6">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Couldn&apos;t join</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{message}</p>
            <Link href="/stories" className={buttonVariants({ variant: 'outline' })}>
              Back to your stories
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }
}
