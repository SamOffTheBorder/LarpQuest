'use client';

import { useState, useTransition } from 'react';

import { resolveReportAction } from '@/app/stories/[storyId]/moderation-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Report } from '@/lib/engine/reports';

export function ReportList({ storyId, reports }: { storyId: string; reports: Report[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (reports.length === 0) {
    return <p className="text-sm text-muted-foreground">No reports filed.</p>;
  }

  function resolve(reportId: string) {
    setError(null);
    setPendingId(reportId);
    startTransition(async () => {
      const result = await resolveReportAction(storyId, reportId);
      if (result.status === 'error') {
        setError(result.message ?? 'Something went wrong.');
      }
      setPendingId(null);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {reports.map((report) => (
        <div key={report.id} className="rounded-md border p-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{report.chapterId !== null ? 'Chapter' : 'Submission'}</Badge>
            <Badge variant={report.status === 'open' ? 'warning' : 'secondary'}>{report.status}</Badge>
            <span className="text-muted-foreground">
              {new Date(report.createdAt).toLocaleString()}
            </span>
          </div>
          <p className="mt-1">{report.reason}</p>
          {report.status === 'open' && (
            <div className="mt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pendingId === report.id}
                onClick={() => resolve(report.id)}
              >
                Resolve
              </Button>
            </div>
          )}
        </div>
      ))}
      {error !== null && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
