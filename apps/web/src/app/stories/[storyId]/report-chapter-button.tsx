'use client';

import { useActionState, useState } from 'react';

import { reportChapterAction, type ReportActionState } from '@/app/stories/[storyId]/report-actions';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

const initialState: ReportActionState = { status: 'idle' };

export function ReportChapterButton({ chapterId }: { chapterId: string }) {
  const [open, setOpen] = useState(false);
  const boundAction = reportChapterAction.bind(null, chapterId);
  const [state, action, pending] = useActionState(boundAction, initialState);

  if (state.status === 'success') {
    return <p className="text-xs text-muted-foreground">Reported. Thanks — a GM will review it.</p>;
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Report
      </Button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      <Textarea name="reason" placeholder="Why are you reporting this chapter?" required rows={2} />
      <div className="flex items-center gap-2">
        <Button type="submit" variant="destructive" size="sm" disabled={pending}>
          {pending ? 'Submitting…' : 'Submit report'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {state.status === 'error' && <p className="text-xs text-destructive">{state.message}</p>}
    </form>
  );
}
