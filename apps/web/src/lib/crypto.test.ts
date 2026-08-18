import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

// The env module reads process.env at import time, so this must be set before
// the module under test is imported.
beforeAll(() => {
  process.env.ENCRYPTION_MASTER_KEY = randomBytes(32).toString('base64');
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
  process.env.OPENROUTER_API_KEY ??= 'test-openrouter-key';
  process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3000';
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key';
  process.env.WORKER_SECRET ??= 'test-worker-secret-value';
});

describe('secret encryption', () => {
  it('round-trips a secret', async () => {
    const { encryptSecret, decryptSecret } = await import('./crypto');
    const secret = 'sk-or-v1-abc123';

    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('produces different ciphertext each time, from a random IV', async () => {
    const { encryptSecret, decryptSecret } = await import('./crypto');
    const secret = 'sk-or-v1-abc123';

    const a = encryptSecret(secret);
    const b = encryptSecret(secret);

    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it('refuses to encrypt an empty secret', async () => {
    const { encryptSecret } = await import('./crypto');
    expect(() => encryptSecret('')).toThrow(/empty/i);
  });

  it('rejects tampered ciphertext via the GCM auth tag', async () => {
    const { encryptSecret, decryptSecret } = await import('./crypto');

    const encrypted = encryptSecret('sk-or-v1-abc123');
    const parts = encrypted.split('.');
    const ciphertext = Buffer.from(parts[2]!, 'base64');
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;

    const tampered = [parts[0], parts[1], ciphertext.toString('base64')].join('.');

    expect(() => decryptSecret(tampered)).toThrow(/authentication check failed/);
  });

  it('rejects a malformed payload', async () => {
    const { decryptSecret } = await import('./crypto');

    expect(() => decryptSecret('not-encrypted')).toThrow(/3 dot-separated parts/);
    expect(() => decryptSecret('a.b')).toThrow(/3 dot-separated parts/);
  });

  it('rejects an IV of the wrong length', async () => {
    const { encryptSecret, decryptSecret } = await import('./crypto');

    const parts = encryptSecret('secret').split('.');
    const shortIv = Buffer.alloc(8).toString('base64');

    expect(() => decryptSecret([shortIv, parts[1], parts[2]].join('.'))).toThrow(/IV must be/);
  });

  it('handles unicode secrets', async () => {
    const { encryptSecret, decryptSecret } = await import('./crypto');
    const secret = 'ключ-🔑-秘密';

    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });
});

describe('master key validation', () => {
  it('rejects a key that is not 32 bytes', async () => {
    const { z } = await import('zod');

    // Mirrors the refinement in env.ts.
    const schema = z.string().refine((v) => Buffer.from(v, 'base64').length === 32);

    expect(schema.safeParse(randomBytes(16).toString('base64')).success).toBe(false);
    expect(schema.safeParse(randomBytes(32).toString('base64')).success).toBe(true);
  });
});
