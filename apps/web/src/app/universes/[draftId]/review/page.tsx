import { notFound } from 'next/navigation';

import { requireUser } from '@/lib/auth';
import { DraftNotFoundError, getDraft, listDraftJobs } from '@/lib/research/drafts';
import { JobsStatusBar } from '@/app/universes/[draftId]/review/jobs-status-bar';
import { PublishButton } from '@/app/universes/[draftId]/review/publish-button';
import { SectionReview } from '@/app/universes/[draftId]/review/section-review';
import { Badge } from '@/components/ui/badge';

const SECTION_ORDER = [
  { key: 'scoping', label: 'Scoping', stage: 'scoping' },
  { key: 'rulesMechanics', label: 'Rules & Mechanics', stage: 'rules_mechanics' },
  { key: 'progression', label: 'Power / Progression', stage: 'progression' },
  { key: 'entities', label: 'Canonical Entities', stage: 'entities' },
  { key: 'timeline', label: 'Timeline & Canon State', stage: 'timeline' },
  { key: 'schemaDerivation', label: 'Entity Schema & Progression Model', stage: 'schema_derivation' },
  { key: 'rulePack', label: 'Rule Pack', stage: 'rule_pack' },
  { key: 'gaps', label: 'Confidence & Gaps', stage: 'gaps' },
] as const;

export default async function ReviewDraftPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  const user = await requireUser();

  let draft;
  try {
    draft = await getDraft(draftId, user.id);
  } catch (error) {
    if (error instanceof DraftNotFoundError) {
      notFound();
    }
    throw error;
  }

  const jobs = await listDraftJobs(draftId, user.id);
  const jobByStage = new Map(jobs.map((job) => [job.stage, job]));

  return (
    <main className="mx-auto flex max-w-3xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">{draft.input.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant={draft.status === 'published' ? 'default' : 'secondary'}>{draft.status}</Badge>
          </div>
        </div>
        {draft.status === 'ready_for_review' && <PublishButton draftId={draftId} />}
      </div>

      <JobsStatusBar draftId={draftId} initialJobs={jobs} />

      <div className="flex flex-col gap-4">
        {SECTION_ORDER.map(({ key, label, stage }) => (
          <SectionReview
            key={key}
            draftId={draftId}
            sectionKey={key}
            label={label}
            document={draft.draft}
            previousOutput={jobByStage.get(stage)?.previousOutput}
          />
        ))}
      </div>
    </main>
  );
}
