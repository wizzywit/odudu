import { describe, expect, it } from 'vitest';
import { insufficientScope, invalidToken, missingCredentials } from '#/service/challenge';

describe('the challenges of the "me" API', () => {
  it('asks for credentials without naming an error when none came', () => {
    expect(missingCredentials()).toBe('Bearer');
  });

  it('names no reason for a token it refused beyond invalid_token', () => {
    expect(invalidToken()).toBe('Bearer error="invalid_token"');
  });

  it('names the scope a call needs (RFC 6750 §3.1)', () => {
    expect(insufficientScope('me:read')).toBe('Bearer error="insufficient_scope", scope="me:read"');
  });
});
