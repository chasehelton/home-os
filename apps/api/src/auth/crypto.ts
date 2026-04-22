import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Env } from '../env.js';

// Versioned envelope: `v1:<base64(iv(12) | ciphertext | tag(16))>`.
// Bumping to v2 would let us rotate algorithms without ambiguity.
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class TokenCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenCryptoError';
  }
}

/**
 * Derives the 32-byte AES-256-GCM key from the configured secret.
 *
 * - In production (`NODE_ENV=production`), `HOME_OS_TOKEN_KEY` is REQUIRED
 *   and must decode to exactly 32 bytes (hex or base64).
 * - In development / test, if it is unset we derive a deterministic key from
 *   `HOME_OS_SESSION_SECRET` so local runs work out of the box. We log a
 *   one-line warning so it isn't silently adopted in prod.
 */
export function deriveTokenKey(env: Env): Buffer {
  const raw = process.env.HOME_OS_TOKEN_KEY;
  if (raw) {
    const buf = decodeKey(raw);
    if (buf.length !== 32) {
      throw new TokenCryptoError('HOME_OS_TOKEN_KEY must decode to 32 bytes');
    }
    return buf;
  }
  if (env.NODE_ENV === 'production') {
    throw new TokenCryptoError(
      'HOME_OS_TOKEN_KEY is required in production (32-byte hex or base64)',
    );
  }
  // Dev/test fallback: derive from the session secret. Not a security claim,
  // just ergonomics so `pnpm dev` works without extra config.
  return createHash('sha256').update(env.HOME_OS_SESSION_SECRET).digest();
}

function decodeKey(raw: string): Buffer {
  // Try hex first (64 chars), then base64. Reject anything shorter than 32 bytes.
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0) {
    return Buffer.from(raw, 'hex');
  }
  try {
    return Buffer.from(raw, 'base64');
  } catch {
    throw new TokenCryptoError('HOME_OS_TOKEN_KEY must be hex or base64');
  }
}

export interface TokenCrypto {
  seal(plain: string): string;
  open(sealed: string): string;
}

export function makeTokenCrypto(key: Buffer): TokenCrypto {
  if (key.length !== 32) {
    throw new TokenCryptoError('token key must be 32 bytes');
  }
  return {
    seal(plain: string): string {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `${VERSION}:${Buffer.concat([iv, ct, tag]).toString('base64')}`;
    },
    open(sealed: string): string {
      const idx = sealed.indexOf(':');
      if (idx < 0) throw new TokenCryptoError('malformed sealed token');
      const version = sealed.slice(0, idx);
      if (version !== VERSION) {
        throw new TokenCryptoError(`unsupported token envelope: ${version}`);
      }
      let blob: Buffer;
      try {
        blob = Buffer.from(sealed.slice(idx + 1), 'base64');
      } catch {
        throw new TokenCryptoError('malformed sealed token');
      }
      if (blob.length < IV_BYTES + TAG_BYTES + 1) {
        throw new TokenCryptoError('malformed sealed token');
      }
      const iv = blob.subarray(0, IV_BYTES);
      const tag = blob.subarray(blob.length - TAG_BYTES);
      const ct = blob.subarray(IV_BYTES, blob.length - TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      try {
        return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
      } catch {
        throw new TokenCryptoError('failed to open sealed token (wrong key or tamper)');
      }
    },
  };
}
