import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authenticationSessionDigest } from '#/service/authentication-session-digest';

describe('authenticationSessionDigest', () => {
  it('is the sha256 of the id in hex, and never the id itself', () => {
    const id = '01a0db22-4754-7575-882b-7be6e7cf6c51';

    const digest = authenticationSessionDigest(id);

    expect(digest).toBe(createHash('sha256').update(id).digest('hex'));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(id);
  });
});
