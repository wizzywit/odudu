import { describe, expect, it } from 'vitest';
import { generateOneTimePassword } from '#/service/one-time-password';

describe('generateOneTimePassword', () => {
  it('is 24 random bytes, base64url, so it pastes without escaping', () => {
    const password = generateOneTimePassword();
    expect(password).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(Buffer.from(password, 'base64url')).toHaveLength(24);
  });

  it('differs on every call', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateOneTimePassword()));
    expect(seen.size).toBe(50);
  });
});
