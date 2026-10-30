import { describe, expect, it, vi } from 'vitest';

vi.mock('node:crypto', () => {
  const draws = ['ZZAdaZZZ', 'ZZZZZZZZ'];
  return {
    randomBytes: () => ({ toString: () => draws.shift() ?? 'QQQQQQQQ' }),
  };
});

const { randomPassword, SEEDED_USERNAMES } =
  await import('../../apps/admin-console/e2e/password.js');

describe('randomPassword', () => {
  it('draws again when the password contains a username, whatever its case', () => {
    expect(randomPassword('P-', ['ada'])).toBe('P-ZZZZZZZZ');
  });

  it('keeps the prefix', () => {
    expect(randomPassword('Visual-', [])).toMatch(/^Visual-/u);
  });

  it('gives up after a bounded number of draws, naming the prefix', () => {
    expect(() => randomPassword('Stuck-', [''])).toThrow(/prefix "Stuck-"/u);
    expect(() => randomPassword('Ada-', ['ada'])).toThrow(/avoided/u);
  });

  it('avoids every username the setup and the specs seed, found in their source', () => {
    expect(SEEDED_USERNAMES.length).toBeGreaterThan(48);
    for (const name of ['wren', 'swift', 'heron', 'lise', 'ines', 'gauss', 'euler', 'grace']) {
      expect(SEEDED_USERNAMES).toContain(name);
    }
  });
});
