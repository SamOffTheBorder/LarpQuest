import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

import { serverEnv } from '@/lib/env';

/**
 * AES-256-GCM encryption for provider API keys.
 *
 * Keys are encrypted at rest; the master key lives in the environment and is
 * never stored in the database. Decryption happens server-side per request —
 * `server-only` makes importing this from a client component a build error.
 *
 * Stored format: base64(iv) . base64(authTag) . base64(ciphertext)
 * The IV and auth tag are not secret; they must be stored alongside the
 * ciphertext to decrypt it.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits, the GCM-recommended nonce length
const AUTH_TAG_BYTES = 16;
const SEPARATOR = '.';

function masterKey(): Buffer {
  return Buffer.from(serverEnv().ENCRYPTION_MASTER_KEY, 'base64');
}

export function encryptSecret(plaintext: string): string {
  if (plaintext.length === 0) {
    throw new Error('Refusing to encrypt an empty secret.');
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(SEPARATOR);
}

export function decryptSecret(encrypted: string): string {
  const parts = encrypted.split(SEPARATOR);

  if (parts.length !== 3) {
    throw new Error('Malformed encrypted secret: expected 3 dot-separated parts.');
  }

  // Destructured explicitly rather than indexed, for noUncheckedIndexedAccess.
  const [ivPart, authTagPart, ciphertextPart] = parts as [string, string, string];

  const iv = Buffer.from(ivPart, 'base64');
  const authTag = Buffer.from(authTagPart, 'base64');
  const ciphertext = Buffer.from(ciphertextPart, 'base64');

  if (iv.length !== IV_BYTES) {
    throw new Error(`Malformed encrypted secret: IV must be ${IV_BYTES} bytes.`);
  }

  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new Error(`Malformed encrypted secret: auth tag must be ${AUTH_TAG_BYTES} bytes.`);
  }

  const decipher = createDecipheriv(ALGORITHM, masterKey(), iv);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // GCM authentication failed: wrong master key, or the ciphertext was
    // tampered with. Deliberately opaque — the caller gets no oracle.
    throw new Error('Failed to decrypt secret: authentication check failed.');
  }
}

/** Constant-time comparison, for any future token/signature checks. */
export function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}
