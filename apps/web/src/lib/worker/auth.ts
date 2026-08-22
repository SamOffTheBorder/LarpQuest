import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import { serverEnv } from '@/lib/env';

/**
 * Shared bearer-token auth for the scheduled worker routes.
 *
 * Two secrets are accepted rather than one. `WORKER_SECRET` is ours, used by
 * any external scheduler we point at these routes. `CRON_SECRET` is the name
 * Vercel Cron injects into its own `Authorization: Bearer ...` header, and it
 * is not configurable there — so a deployment on Vercel Cron authenticates
 * with CRON_SECRET while a deployment on GitHub Actions or cron-job.org uses
 * WORKER_SECRET, with no route-level branch on which scheduler is calling.
 *
 * Setting both to the same value is fine and is what `.env.example` suggests.
 */

/**
 * Compare in constant time. These routes are reachable by anyone who knows the
 * URL, so a naive `===` leaks the secret one byte at a time under timing
 * analysis — cheap to avoid, expensive to discover you needed.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  // timingSafeEqual throws on a length mismatch, which would itself leak
  // length. Compare against a fixed-length digest-free padding by checking
  // length separately only after a same-length comparison has been done.
  if (a.length !== b.length) {
    // Still burn a comparison so the failure path costs roughly the same.
    timingSafeEqual(a, a);
    return false;
  }

  return timingSafeEqual(a, b);
}

/**
 * True when the request carries a valid worker bearer token.
 *
 * `CRON_SECRET` is optional in the environment schema; when it is unset only
 * `WORKER_SECRET` is accepted, so an absent CRON_SECRET can never widen access
 * to requests presenting an empty token.
 */
export function isAuthorizedWorkerRequest(request: Request): boolean {
  const header = request.headers.get('authorization');

  if (header === null || !header.startsWith('Bearer ')) {
    return false;
  }

  const provided = header.slice('Bearer '.length);
  const env = serverEnv();

  const accepted = [env.WORKER_SECRET, env.CRON_SECRET].filter(
    (secret): secret is string => secret !== undefined && secret.length > 0,
  );

  return accepted.some((secret) => secretsMatch(provided, secret));
}
