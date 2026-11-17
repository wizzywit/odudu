import { describe, expect, it } from 'vitest';
import { chooseUsername, generateHandle, HANDLE_ATTEMPTS } from '#/service/username-choice';

describe('generateHandle', () => {
  it('maps zero bytes to the first letter', () => {
    expect(generateHandle(new Uint8Array(10))).toBe('u-aaaaaaaaaa');
  });

  it('keeps the low five bits of a byte', () => {
    const bytes = new Uint8Array(10);
    bytes[0] = 31;
    bytes[1] = 32;
    bytes[2] = 0xff;
    expect(generateHandle(bytes)).toBe('u-7a7aaaaaaa');
  });

  it('is 12 characters from the alphabet for any bytes', () => {
    for (let i = 0; i < 200; i += 1) {
      const handle = generateHandle(crypto.getRandomValues(new Uint8Array(10)));
      expect(handle).toMatch(/^u-[a-z2-7]{10}$/u);
      expect(handle).toHaveLength(12);
    }
  });

  it('refuses fewer than ten bytes', () => {
    expect(() => generateHandle(new Uint8Array(9))).toThrow(RangeError);
  });

  it('ignores bytes past the tenth', () => {
    expect(generateHandle(new Uint8Array(16).fill(1))).toBe(
      generateHandle(new Uint8Array(10).fill(1)),
    );
  });
});

describe('chooseUsername', () => {
  it('asks for a username while one is required', () => {
    expect(chooseUsername('required', undefined)).toEqual({ kind: 'missing' });
    expect(chooseUsername('required', '')).toEqual({ kind: 'missing' });
    expect(chooseUsername('required', 'ann')).toEqual({ kind: 'use', username: 'ann' });
  });

  it('uses a posted name while optional, and generates when none came', () => {
    expect(chooseUsername('optional', 'ann')).toEqual({ kind: 'use', username: 'ann' });
    expect(chooseUsername('optional', undefined)).toEqual({ kind: 'generate' });
    expect(chooseUsername('optional', '')).toEqual({ kind: 'generate' });
  });

  it('generates whatever was posted while generated', () => {
    expect(chooseUsername('generated', 'ann')).toEqual({ kind: 'generate' });
    expect(chooseUsername('generated', undefined)).toEqual({ kind: 'generate' });
  });

  it('retries a collision three times', () => {
    expect(HANDLE_ATTEMPTS).toBe(3);
  });
});
