import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireUser } from '@/lib/auth';
import { overrideProposalAction, overrideValidationFlagAction } from '@/app/stories/[storyId]/consistency/override-actions';
import { OverrideButton } from '@/app/stories/[storyId]/consistency/override-button';
import { listChapters } from '@/lib/engine/chapters';
import { getChapterValidationReport, getStoryProposalHistory } from '@/lib/engine/consistency-report';
import { listMembers } from '@/lib/engine/membership';
import { StoryNotFoundError, getStory } from '@/lib/engine/stories';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const SEVERITY_VARIANT = {
  block: 'destructive',
  warn: 'warning',
  log: 'outline',
} as const;

const VERDICT_VARIANT = {
  allow: 'success',
  allow_with_limits: 'warning',
  reject: 'destructive',
} as const;

export default async function ConsistencyReportPage({
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
  const canOverride = members.some(
    (member) => member.userId === user.id && (member.role === 'owner' || member.role === 'gm'),
  );

  const [chapters, proposals] = await Promise.all([
    listChapters(storyId, user.id),
    getStoryProposalHistory(storyId, user.id),
  ]);

  const reports = await Promise.all(
    chapters.map((chapter) => getChapterValidationReport(chapter.id, user.id)),
  );

  const flaggedReports = reports.filter((report) => report.evaluated && report.flags.length > 0);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{story.title} — Consistency Report</h1>
        <Link href={`/stories/${storyId}`} className={buttonVariants({ variant: 'outline' })}>
          Back to story
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Validation flags</CardTitle>
        </CardHeader>
        <CardContent>
          {flaggedReports.length === 0 ? (
            <p className="text-sm text-muted-foreground">No chapters have been flagged.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {flaggedReports.map((report) => (
                <div key={report.chapterId} className="rounded-md border p-3">
                  <p className="mb-2 text-sm font-medium">Turn {report.turnNumber}</p>
                  <div className="flex flex-col gap-3">
                    {report.flags.map((flag, index) => (
                      <div key={`${report.chapterId}-${flag.ruleId}-${index}`} className="rounded-md bg-muted/40 p-2 text-sm">
                        <div className="mb-1 flex items-center gap-2">
                          <Badge variant={SEVERITY_VARIANT[flag.severity]}>{flag.severity}</Badge>
                          <span className="font-mono text-xs text-muted-foreground">{flag.ruleId}</span>
                        </div>
                        <p>{flag.description}</p>
                        {canOverride && (
                          <div className="mt-2">
                            <OverrideButton
                              action={overrideValidationFlagAction.bind(
                                null,
                                report.chapterId,
                                flag.ruleId,
                                flag.entityId,
                                flag.capabilityId,
                              )}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proposal history</CardTitle>
        </CardHeader>
        <CardContent>
          {proposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No proposals have been evaluated.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {proposals.map((proposal) => (
                <div key={proposal.id} className="rounded-md border p-3 text-sm">
                  <div className="mb-1 flex items-center gap-2">
                    {proposal.verdict !== null && (
                      <Badge variant={VERDICT_VARIANT[proposal.verdict]}>{proposal.verdict}</Badge>
                    )}
                    {proposal.gmOverride && <Badge variant="secondary">overridden</Badge>}
                    <span className="text-xs text-muted-foreground">
                      {new Date(proposal.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="font-medium">{proposal.proposal}</p>
                  {proposal.reasoning !== null && (
                    <p className="mt-1 text-muted-foreground">{proposal.reasoning}</p>
                  )}
                  {canOverride && proposal.verdict !== 'allow' && !proposal.gmOverride && (
                    <div className="mt-2">
                      <OverrideButton action={overrideProposalAction.bind(null, proposal.id)} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
