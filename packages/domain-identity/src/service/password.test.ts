import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '#/service/password';

describe('[ODUDU-PASSWORD-HASHING-01] password verification', () => {
  it('round-trips a password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword(hash, 'correct-horse-battery-staple')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    expect(await verifyPassword(await hashPassword('a'), 'b')).toBe(false);
  });

  it('produces a different hash for the same password each time', async () => {
    expect(await hashPassword('a')).not.toEqual(await hashPassword('a'));
  });

  it('produces an argon2id hash, not argon2i or argon2d', async () => {
    expect(await hashPassword('a')).toMatch(/^\$argon2id\$/);
  });

  it('returns false rather than throwing on a malformed stored hash', async () => {
    expect(await verifyPassword('not-a-hash', 'a')).toBe(false);
  });
});
