import { NextResponse } from 'next/server';

import { sweepDeadlines } from '@/lib/engine/deadlines';
import { isAuthorizedWorkerRequest } from '@/lib/worker/auth';

/**
 * Deadline sweep entry point.
 *
 * Not user-facing: called by a scheduled trigger (cron) with a bearer token,
 * mirrors api/worker/extract/route.ts exactly. One call sweeps every due
 * turn across every story, since (unlike extraction/memory) there is no
 * single-row queue to drain incrementally here.
 */
async function handle(request: Request) {
  if (!isAuthorizedWorkerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const outcome = await sweepDeadlines();
    return NextResponse.json(outcome);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 200, not 500: a sweep failure is worker observability, not story state
    // — turns that were already locked stay locked either way.
    return NextResponse.json({ checked: 0, locked: 0, blocked: 0, error: message }, { status: 200 });
  }
}

export { handle as GET, handle as POST };
