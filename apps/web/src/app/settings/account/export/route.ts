import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth';
import { requestAccountExport } from '@/lib/engine/account-export';

/**
 * Self-serve account data export. Synchronous — no job/storage bucket,
 * unlike story export's PDF/EPUB rendering, since this is a handful of
 * already-small rows with no rendering step. See account-export.ts.
 */
export async function GET() {
  const user = await requireUser();

  const data = await requestAccountExport(user.id);

  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="account-export.json"',
    },
  });
}
