import { NextResponse } from 'next/server';

import { runOneMemoryJob } from '@/lib/engine/memory-worker';
import { isAuthorizedWorkerRequest } from '@/lib/worker/auth';

/**
 * Memory worker entry point. Mirrors `api/worker/extract/route.ts` exactly:
 * a static shared secret (no user session in a cron invocation), one call
 * claims and processes one queue row, and a job's own failure is already
 * recorded on the queue row and the chapter — so this always returns 200,
 * never surfacing the job failure as an HTTP error.
 */
async function handle(request: Request) {
  if (!isAuthorizedWorkerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const outcome = await runOneMemoryJob();
    return NextResponse.json(outcome);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ claimed: true, error: message }, { status: 200 });
  }
}

export { handle as GET, handle as POST };
