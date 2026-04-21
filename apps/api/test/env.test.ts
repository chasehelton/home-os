import { describe, it, expect } from 'vitest';
import { allowedEmails } from '../src/env.js';
import { makeTestEnv } from './_helpers.js';

describe('allowedEmails', () => {
  it('parses a comma list, lowercases, trims, drops blanks', () => {
    const env = makeTestEnv({ HOME_OS_ALLOWED_EMAILS: 'A@x.com, b@x.com ,, ' });
    const set = allowedEmails(env);
    expect(set.has('a@x.com')).toBe(true);
    expect(set.has('b@x.com')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('returns an empty set when unset', () => {
    const env = makeTestEnv({ HOME_OS_ALLOWED_EMAILS: '' });
    expect(allowedEmails(env).size).toBe(0);
  });
});
