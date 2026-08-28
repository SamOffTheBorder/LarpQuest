import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The app must refuse to start on bad configuration. The failure mode being
 * prevented is provider keys written unencrypted because ENCRYPTION_MASTER_KEY
 * silently defaulted to undefined.
 */

const ORIGINAL = { ...process.env };

function setValidEnv() {
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.OPENROUTER_API_KEY = 'openrouter';
  process.env.ENCRYPTION_MASTER_KEY = randomBytes(32).toString('base64');
  process.env.WORKER_SECRET = 'test-worker-secret-value';
}

beforeEach(() => {
  vi.resetModules();
  setValidEnv();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('server env validation', () => {
  it('accepts a valid configuration', async () => {
    const { serverEnv } = await import('./env');
    expect(serverEnv().OPENROUTER_API_KEY).toBe('openrouter');
  });

  it('throws when the master key is missing', async () => {
    delete process.env.ENCRYPTION_MASTER_KEY;

    const { serverEnv } = await import('./env');
    expect(() => serverEnv()).toThrow(/ENCRYPTION_MASTER_KEY/);
  });

  it('throws when the master key is the wrong length', async () => {
    process.env.ENCRYPTION_MASTER_KEY = randomBytes(16).toString('base64');

    const { serverEnv } = await import('./env');
    expect(() => serverEnv()).toThrow(/32 bytes/);
  });

  it('throws when the service role key is missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { serverEnv } = await import('./env');
    expect(() => serverEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('names every problem at once rather than one at a time', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.WORKER_SECRET;

    const { serverEnv } = await import('./env');

    try {
      serverEnv();
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(message).toContain('WORKER_SECRET');
      expect(message).toContain('.env.example');
    }
  });

  it('accepts a missing OPENROUTER_API_KEY — a fully-local deployment never needs one', async () => {
    delete process.env.OPENROUTER_API_KEY;

    const { serverEnv } = await import('./env');
    expect(serverEnv().OPENROUTER_API_KEY).toBeUndefined();
  });

  it('defaults OLLAMA_BASE_URL to the standard local port', async () => {
    const { serverEnv } = await import('./env');
    expect(serverEnv().OLLAMA_BASE_URL).toBe('http://localhost:11434');
  });

  it('accepts an explicit OLLAMA_BASE_URL override', async () => {
    process.env.OLLAMA_BASE_URL = 'http://192.168.1.50:11434';

    const { serverEnv } = await import('./env');
    expect(serverEnv().OLLAMA_BASE_URL).toBe('http://192.168.1.50:11434');
  });

  it('caches after a successful parse', async () => {
    const { serverEnv } = await import('./env');

    expect(serverEnv().OPENROUTER_API_KEY).toBe('openrouter');
    delete process.env.OPENROUTER_API_KEY;
    expect(serverEnv().OPENROUTER_API_KEY).toBe('openrouter');
  });
});

describe('client env validation', () => {
  it('rejects a non-URL Supabase URL', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'not-a-url';

    await expect(import('./env')).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
