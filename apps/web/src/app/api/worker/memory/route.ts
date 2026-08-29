import { NextResponse } from 'next/server';

import { runOneMemoryJob } from '@/lib/engine/memory-worker';
import { isAuthorizedWorkerRequest } from '@/lib/worker/auth';
import { drainQueue } from '@/lib/worker/drain';

/**
 * Memory worker entry point. Mirrors `api/worker/extract/route.ts` exactly:
 * a static shared secret (no user session in a cron invocation), one
 * invocation drains the queue through `lib/worker/drain.ts`, and a job's own
 * failure is already recorded on the queue row and the chapter — so this
 * always returns 200, never surfacing a job failure as an HTTP error.
 */

export const maxDuration = 60;

async function handle(request: Request) {
  if (!isAuthorizedWorkerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await drainQueue(() => runOneMemoryJob());

  return NextResponse.json(result);
}

export { handle as GET, handle as POST };
