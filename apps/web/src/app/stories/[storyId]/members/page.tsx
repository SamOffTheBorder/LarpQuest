import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireUser } from '@/lib/auth';
import { listInvites } from '@/lib/engine/invites';
import { listMembers, requireRole } from '@/lib/engine/membership';
import { listReports } from '@/lib/engine/reports';
import { listShareLinks } from '@/lib/engine/share-links';
import { StoryNotFoundError, getStory } from '@/lib/engine/stories';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InviteForm } from '@/app/stories/[storyId]/members/invite-form';
import { InviteList } from '@/app/stories/[storyId]/members/invite-list';
import { MemberList } from '@/app/stories/[storyId]/members/member-list';
import { ReportList } from '@/app/stories/[storyId]/members/report-list';
import { ShareLinkList } from '@/app/stories/[storyId]/members/share-link-list';

export default async function MembersPage({
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

  const members = await listMembers(storyId, user.id);
  const isManager = members.some(
    (member) => member.userId === user.id && (member.role === 'owner' || member.role === 'gm'),
  );

  const [invites, reports, shareLinks] = isManager
    ? await Promise.all([listInvites(storyId, user.id), listReports(storyId, user.id), listShareLinks(storyId, user.id)])
    : [[], [], []];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{story.title} — Members</h1>
        <Link href={`/stories/${storyId}`} className={buttonVariants({ variant: 'outline' })}>
          Back to story
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
        </CardHeader>
        <CardContent>
          <MemberList storyId={storyId} members={members} currentUserId={user.id} canManage={isManager} />
        </CardContent>
      </Card>

      {isManager && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Invite someone</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <InviteForm storyId={storyId} />
              <InviteList storyId={storyId} invites={invites} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Share links</CardTitle>
            </CardHeader>
            <CardContent>
              <ShareLinkList storyId={storyId} shareLinks={shareLinks} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reports</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportList storyId={storyId} reports={reports} />
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
