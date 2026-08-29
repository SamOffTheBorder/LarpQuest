import { NextResponse } from 'next/server';

import { runOneExtraction } from '@/lib/engine/extraction-worker';
import { isAuthorizedWorkerRequest } from '@/lib/worker/auth';
import { drainQueue } from '@/lib/worker/drain';

/**
 * Extraction worker entry point.
 *
 * Not user-facing: called by a scheduled trigger (cron) with a bearer token,
 * never by the browser. One invocation drains the queue — repeatedly claiming
 * and processing single rows until the queue is empty or a job/time budget is
 * reached (see `lib/worker/drain.ts`). Draining rather than processing one row
 * per call is what lets a low-frequency cron keep up with an active story:
 * otherwise a day's chapters take a day each to have their state extracted.
 *
 * Auth is a static shared secret rather than requireUser() — there is no user
 * session in a cron invocation. See `lib/worker/auth.ts` for which secrets are
 * accepted and why there are two.
 *
 * Both GET and POST are exported and identical: Vercel Cron issues GET and
 * cannot be configured to POST, while external schedulers generally POST.
 */

/** Give the drain loop room to work inside the platform's execution ceiling. */
export const maxDuration = 60;

async function handle(request: Request) {
  if (!isAuthorizedWorkerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 200 even when a job failed: the failure is already recorded on the queue
  // row and the chapter, and a 500 here would only affect worker
  // observability, not story state — the chapter stays published either way.
  const result = await drainQueue(() => runOneExtraction());

  return NextResponse.json(result);
}

export { handle as GET, handle as POST };
