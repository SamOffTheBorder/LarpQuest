import { NextResponse, type NextRequest } from 'next/server';

import { runOneExtraction } from '@/lib/engine/extraction-worker';
import { serverEnv } from '@/lib/env';

/**
 * Extraction worker entry point.
 *
 * Not user-facing: called by a scheduled trigger (cron) with a bearer token,
 * never by the browser. One call claims and processes one queue row, so a
 * scheduler polling this endpoint drains the queue over successive calls
 * rather than one request running an unbounded loop.
 *
 * Auth is a static shared secret rather than requireUser() — there is no user
 * session in a cron invocation.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${serverEnv().WORKER_SECRET}`;

  if (authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const outcome = await runOneExtraction();
    return NextResponse.json(outcome);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 200, not 500: the job's own failure is already recorded on the queue
    // row and the chapter. A 500 here would only affect worker observability,
    // not story state — the chapter stays published either way.
    return NextResponse.json({ claimed: true, error: message }, { status: 200 });
  }
}
