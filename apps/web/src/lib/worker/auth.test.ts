import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The worker routes are reachable by anyone who knows the URL, so their only
 * protection is this check. The cases that matter are the ones that would
 * silently widen access: an unset CRON_SECRET, a missing header, and a token
 * that is a prefix of the real one.
 */

const ORIGINAL = { ...process.env };

const WORKER_SECRET = 'worker-secret-long-enough';
const CRON_SECRET = 'cron-secret-also-long-enough';

function setValidEnv() {
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.OPENROUTER_API_KEY = 'openrouter';
  process.env.ENCRYPTION_MASTER_KEY = randomBytes(32).toString('base64');
  process.env.WORKER_SECRET = WORKER_SECRET;
  delete process.env.CRON_SECRET;
}

beforeEach(() => {
  vi.resetModules();
  setValidEnv();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

function requestWith(authorization: string | null): Request {
  return new Request('https://example.test/api/worker/extract', {
    headers: authorization === null ? {} : { authorization },
  });
}

describe('isAuthorizedWorkerRequest', () => {
  it('accepts the worker secret', async () => {
    const { isAuthorizedWorkerRequest } = await import('./auth');
    expect(isAuthorizedWorkerRequest(requestWith(`Bearer ${WORKER_SECRET}`))).toBe(true);
  });

  it('accepts the cron secret when one is configured', async () => {
    process.env.CRON_SECRET = CRON_SECRET;

    const { isAuthorizedWorkerRequest } = await import('./auth');
    expect(isAuthorizedWorkerRequest(requestWith(`Bearer ${CRON_SECRET}`))).toBe(true);
    // The worker secret keeps working alongside it.
    expect(isAuthorizedWorkerRequest(requestWith(`Bearer ${WORKER_SECRET}`))).toBe(true);
  });

  it('rejects the cron secret when none is configured', async () => {
    const { isAuthorizedWorkerRequest } = await import('./auth');
    expect(isAuthorizedWorkerRequest(requestWith(`Bearer ${CRON_SECRET}`))).toBe(false);
  });

  it('rejects a missing header', async () => {
    const { isAuthorizedWorkerRequest } = await import('./auth');
    expect(isAuthorizedWorkerRequest(requestWith(null))).toBe(false);
  });

  it('rejects a header without the Bearer scheme', async () => {
    const { isAuthorizedWorkerRequest } = await import('./auth');
    expect(isAuthorizedWorkerRequest(requestWith(WORKER_SECRET))).toBe(false);
  });

  it('rejects an empty token', async () => {
    const { isAuthorizedWorkerRequest } = await import('./auth');
    expect(isAuthorizedWorkerRequest(requestWith('Bearer '))).toBe(false);
  });

  it('rejects a token that is a prefix of the real secret', async () => {
    const { isAuthorizedWorkerRequest } = await import('./auth');
    expect(isAuthorizedWorkerRequest(requestWith(`Bearer ${WORKER_SECRET.slice(0, -1)}`))).toBe(false);
  });

  it('rejects a token that extends the real secret', async () => {
    const { isAuthorizedWorkerRequest } = await import('./auth');
    expect(isAuthorizedWorkerRequest(requestWith(`Bearer ${WORKER_SECRET}x`))).toBe(false);
  });
});
