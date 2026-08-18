import { NextResponse, type NextRequest } from 'next/server';

import { requireUserForApi } from '@/lib/auth';
import { generateTurn, lockTurn, retryTurn, TurnStateError } from '@/lib/engine/turns';

/**
 * Streams generation progress as Server-Sent Events.
 *
 * The request stays open until `generateTurn`/`retryTurn` resolves — the same
 * "must fully complete, cannot fire-and-forget" invariant the earlier Server
 * Action version relied on, since an interrupted `generating` turn has no
 * retry path (retry only accepts `failed`). This route just makes the
 * in-flight prose visible to the browser instead of hiding it behind a static
 * "narrator is writing" message.
 *
 * `mode: "lock"` locks the turn before generating (the normal path from
 * `open`); `mode: "retry"` regenerates a `failed` turn's original submissions
 * verbatim. Both are POST, not GET: they mutate state and are not safe to
 * prefetch or cache.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ storyId: string; turnId: string }> },
) {
  const user = await requireUserForApi();

  if (user === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { turnId } = await params;
  const body = (await request.json().catch(() => ({}))) as { mode?: string };
  const mode = body.mode === 'retry' ? 'retry' : 'lock';

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      try {
        if (mode === 'lock') {
          await lockTurn(turnId, user.id);
          send({ type: 'locked' });
        }

        const run = mode === 'retry' ? retryTurn : generateTurn;

        const result = await run(turnId, user.id, (accumulated) => {
          send({ type: 'chunk', prose: accumulated });
        });

        send({ type: 'done', chapterId: result.chapterId, turnNumber: result.turnNumber });
      } catch (error) {
        const message =
          error instanceof TurnStateError || error instanceof Error
            ? error.message
            : 'Generation failed.';
        send({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
