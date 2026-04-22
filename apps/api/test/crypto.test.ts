import { describe, it, expect } from 'vitest';
import { makeTokenCrypto, deriveTokenKey } from '../src/auth/crypto.js';
import { makeTestEnv } from './_helpers.js';

describe('TokenCrypto', () => {
  const key = deriveTokenKey(makeTestEnv());
  const c = makeTokenCrypto(key);

  it('round-trips a secret through v1 envelope', () => {
    const sealed = c.seal('hello-world-refresh-token');
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(c.open(sealed)).toBe('hello-world-refresh-token');
  });

  it('produces distinct ciphertexts for the same plaintext (random IV)', () => {
    const a = c.seal('same-secret');
    const b = c.seal('same-secret');
    expect(a).not.toBe(b);
    expect(c.open(a)).toBe('same-secret');
    expect(c.open(b)).toBe('same-secret');
  });

  it('rejects a value sealed under a different key', () => {
    const other = makeTokenCrypto(
      deriveTokenKey(
        makeTestEnv({ HOME_OS_SESSION_SECRET: 'a-completely-different-secret-value-123' }),
      ),
    );
    const sealed = other.seal('secret');
    expect(() => c.open(sealed)).toThrow();
  });

  it('rejects a tampered ciphertext', () => {
    const sealed = c.seal('secret');
    const parts = sealed.split(':');
    const b64 = parts[1] ?? '';
    const buf = Buffer.from(b64, 'base64');
    // Flip one bit in the ciphertext body (after 12-byte IV).
    buf[14] = (buf[14] ?? 0) ^ 0x01;
    const tampered = `${parts[0]}:${buf.toString('base64')}`;
    expect(() => c.open(tampered)).toThrow();
  });

  it('rejects an unknown envelope version', () => {
    expect(() => c.open('v2:abcd')).toThrow();
  });

  it('requires a 32-byte key', () => {
    expect(() => makeTokenCrypto(Buffer.alloc(16))).toThrow();
    expect(() => makeTokenCrypto(Buffer.alloc(32))).not.toThrow();
  });

  it('deriveTokenKey throws in production without HOME_OS_TOKEN_KEY', () => {
    const prev = process.env.HOME_OS_TOKEN_KEY;
    delete process.env.HOME_OS_TOKEN_KEY;
    try {
      expect(() => deriveTokenKey(makeTestEnv({ NODE_ENV: 'production' as const }))).toThrow();
    } finally {
      if (prev !== undefined) process.env.HOME_OS_TOKEN_KEY = prev;
    }
  });
});
