'use client';

import { useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import type { ResearchJobStatus } from '@/lib/research/drafts';
import { Badge } from '@/components/ui/badge';

/**
 * Live per-stage progress via Supabase Realtime on `research_jobs`
 * (research-pipeline spec, "Progress is streamed") — no polling. The initial
 * snapshot comes from the server component that renders this; the
 * subscription only applies updates from that point forward, so a browser
 * that opens the page mid-pipeline still starts from accurate state.
 */

const STAGE_LABELS: Record<string, string> = {
  scoping: 'Scoping',
  rules_mechanics: 'Rules & Mechanics',
  progression: 'Power / Progression',
  entities: 'Canonical Entities',
  timeline: 'Timeline & Canon State',
  schema_derivation: 'Schema Derivation',
  rule_pack: 'Rule Pack',
  gaps: 'Confidence & Gaps',
};

const STATUS_VARIANT: Record<
  ResearchJobStatus['status'],
  'success' | 'warning' | 'destructive' | 'outline'
> = {
  queued: 'outline',
  running: 'warning',
  complete: 'success',
  failed: 'destructive',
  skipped: 'outline',
};

interface ResearchJobRow {
  stage: string;
  status: string;
  attempt_count: number;
  output: unknown;
  previous_output: unknown;
  last_error: string | null;
  updated_at: string;
}

function fromRow(row: ResearchJobRow): ResearchJobStatus {
  return {
    stage: row.stage as ResearchJobStatus['stage'],
    status: row.status as ResearchJobStatus['status'],
    attemptCount: row.attempt_count,
    output: row.output,
    previousOutput: row.previous_output,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

export function JobsStatusBar({
  draftId,
  initialJobs,
}: {
  draftId: string;
  initialJobs: ResearchJobStatus[];
}) {
  const [jobs, setJobs] = useState(initialJobs);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`research_jobs:${draftId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'research_jobs', filter: `draft_id=eq.${draftId}` },
        (payload) => {
          const updated = fromRow(payload.new as ResearchJobRow);
          setJobs((current) => current.map((job) => (job.stage === updated.stage ? updated : job)));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [draftId]);

  const allDone = jobs.every((job) => job.status === 'complete' || job.status === 'skipped' || job.status === 'failed');

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex flex-wrap gap-2">
        {jobs.map((job) => (
          <Badge key={job.stage} variant={STATUS_VARIANT[job.status]}>
            {STAGE_LABELS[job.stage] ?? job.stage}: {job.status}
          </Badge>
        ))}
      </div>
      {!allDone && <p className="text-sm text-muted-foreground">Research in progress…</p>}
    </div>
  );
}
