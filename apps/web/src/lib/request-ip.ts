import 'server-only';

import { headers } from 'next/headers';

/**
 * Best-effort caller IP for the one rate-limited path with no session to key
 * on instead (sign-in). `x-forwarded-for` is set by Vercel's edge network and
 * by most reverse proxies; a request that reaches this app directly (local
 * dev, a misconfigured proxy) has no such header, so this falls back to a
 * constant. That fallback means every such request shares one rate-limit
 * bucket — a real weakening of the limit, acceptable in local dev where it
 * does not matter, and worth noting as a real gap if this deployment is ever
 * exposed directly rather than through a proxy that sets the header.
 */
export async function callerIp(): Promise<string> {
  const headerList = await headers();
  const forwardedFor = headerList.get('x-forwarded-for');

  if (forwardedFor !== null) {
    // The header is a comma-separated chain; the first entry is the original
    // client as seen by the nearest proxy that appended to it.
    const first = forwardedFor.split(',')[0]?.trim();
    if (first !== undefined && first.length > 0) {
      return first;
    }
  }

  return 'unknown';
}
