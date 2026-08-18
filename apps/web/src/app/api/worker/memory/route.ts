import { NextResponse, type NextRequest } from 'next/server';

import { runOneMemoryJob } from '@/lib/engine/memory-worker';
import { serverEnv } from '@/lib/env';

/**
 * Memory worker entry point. Mirrors `api/worker/extract/route.ts` exactly:
 * a static shared secret (no user session in a cron invocation), one call
 * claims and processes one queue row, and a job's own failure is already
 * recorded on the queue row and the chapter — so this always returns 200,
 * never surfacing the job failure as an HTTP error.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${serverEnv().WORKER_SECRET}`;

  if (authHeader !== expected) {
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
