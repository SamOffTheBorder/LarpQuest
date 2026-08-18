'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { openTurnAction } from '@/app/stories/[storyId]/actions';
import { SubmissionForm } from '@/app/stories/[storyId]/submission-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Story } from '@/lib/engine/stories';
import type { Submission, Turn } from '@/lib/engine/turns';

interface TurnPanelProps {
  storyId: string;
  story: Story;
  turn: Turn | null;
  submissions: Submission[];
  userId: string;
}

type StreamEvent =
  | { type: 'locked' }
  | { type: 'chunk'; prose: string }
  | { type: 'done'; chapterId: string; turnNumber: number }
  | { type: 'error'; message: string };

export function TurnPanel({ storyId, story, turn, submissions, userId }: TurnPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [streamedProse, setStreamedProse] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  function runAction(action: () => Promise<{ status: 'idle' | 'error'; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.status === 'error') {
        setError(result.message ?? 'Something went wrong.');
      }
    });
  }

  async function runGeneration(turnId: string, mode: 'lock' | 'retry') {
    setError(null);
    setStreamedProse('');
    setIsStreaming(true);

    try {
      const response = await fetch(`/stories/${storyId}/turns/${turnId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });

      if (response.body === null) {
        throw new Error('No response stream.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) {
            continue;
          }

          const event = JSON.parse(line.slice(6)) as StreamEvent;

          if (event.type === 'chunk') {
            setStreamedProse(event.prose);
          } else if (event.type === 'error') {
            setError(event.message);
          }
          // 'locked' and 'done' need no local state — router.refresh() below
          // re-reads the turn/chapter from the server either way.
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Generation failed.');
    } finally {
      setIsStreaming(false);
      setStreamedProse(null);
      router.refresh();
    }
  }

  if (turn === null) {
    if (story.status === 'archived') {
      return (
        <Card>
          <CardContent className="py-6 text-center text-muted-foreground">
            This story is archived and cannot accept new turns.
          </CardContent>
        </Card>
      );
    }

    return (
      <Card>
        <CardContent className="flex items-center justify-between py-6">
          <p className="text-muted-foreground">No turn is currently open.</p>
          <Button disabled={pending} onClick={() => runAction(() => openTurnAction(storyId))}>
            Open next turn
          </Button>
        </CardContent>
        {error !== null && <p className="px-6 pb-4 text-sm text-destructive">{error}</p>}
      </Card>
    );
  }

  const mySubmission = submissions.find((submission) => submission.userId === userId) ?? null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Turn {story.currentTurn + 1}</CardTitle>
        <TurnStatusBadge status={turn.status} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {turn.sceneSetup !== null && <p className="text-sm">{turn.sceneSetup}</p>}

        {turn.status === 'open' && (
          <>
            <SubmissionForm storyId={storyId} turnId={turn.id} existing={mySubmission} />
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {submissions.length} submission{submissions.length === 1 ? '' : 's'} so far
              </p>
              <Button
                disabled={isStreaming || submissions.length === 0}
                onClick={() => runGeneration(turn.id, 'lock')}
              >
                {isStreaming ? 'Generating…' : 'Lock and generate'}
              </Button>
            </div>
          </>
        )}

        {isStreaming && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">The narrator is writing…</p>
            {streamedProse !== null && streamedProse.length > 0 && (
              <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm leading-relaxed">
                {streamedProse}
              </p>
            )}
          </div>
        )}

        {!isStreaming && (turn.status === 'locked' || turn.status === 'generating') && (
          <p className="text-sm text-muted-foreground">
            Generation is in progress in another session. This page will update when it&apos;s
            ready.
          </p>
        )}

        {!isStreaming && turn.status === 'failed' && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-destructive">
              Generation failed: {turn.failureReason ?? 'Unknown error.'}
            </p>
            {turn.partialProse !== null && (
              <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                Partial draft: {turn.partialProse}
              </p>
            )}
            <Button onClick={() => runGeneration(turn.id, 'retry')}>Retry generation</Button>
          </div>
        )}

        {error !== null && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function TurnStatusBadge({ status }: { status: Turn['status'] }) {
  if (status === 'failed') {
    return <Badge variant="destructive">Failed</Badge>;
  }

  if (status === 'generating' || status === 'locked') {
    return <Badge variant="secondary">Generating</Badge>;
  }

  return <Badge>Open</Badge>;
}
