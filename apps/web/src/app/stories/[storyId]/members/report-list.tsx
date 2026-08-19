import { Badge } from '@/components/ui/badge';
import type { Report } from '@/lib/engine/reports';

export function ReportList({ reports }: { reports: Report[] }) {
  if (reports.length === 0) {
    return <p className="text-sm text-muted-foreground">No reports filed.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {reports.map((report) => (
        <div key={report.id} className="rounded-md border p-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{report.chapterId !== null ? 'Chapter' : 'Submission'}</Badge>
            <span className="text-muted-foreground">
              {new Date(report.createdAt).toLocaleString()}
            </span>
          </div>
          <p className="mt-1">{report.reason}</p>
        </div>
      ))}
    </div>
  );
}
