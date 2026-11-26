import { describe, expect, it } from 'vitest';
import { maskEmailAddresses } from '#/service/mask-emails';

describe('maskEmailAddresses', () => {
  it.each([
    ['ada@example.com', 'a***@example.com'],
    ['Write to grace.hopper+news@mail.navy.mil today', 'Write to g***@mail.navy.mil today'],
    ['a@b.io', 'a***@b.io'],
    ['"x_y-z%1@sub.example.co.uk",', '"x***@sub.example.co.uk",'],
    ['ada@example.com and bob@example.org', 'a***@example.com and b***@example.org'],
    ['{"email":"ada@example.com","name":"Ada"}', '{"email":"a***@example.com","name":"Ada"}'],
  ])('masks %s', (input, expected) => {
    expect(maskEmailAddresses(input)).toBe(expected);
  });

  it.each([
    'no address here',
    '@handle and @another',
    'user@',
    'user@localhost',
    'version 1.2.3 at 10:30',
    'a@1.2',
    'ratio 3@4.5',
    'https://example.com/path?x=1',
  ])('leaves %s alone', (input) => {
    expect(maskEmailAddresses(input)).toBe(input);
  });

  it('is stable: masking a masked text changes nothing', () => {
    const once = maskEmailAddresses('ada@example.com');
    expect(maskEmailAddresses(once)).toBe(once);
  });

  it('is linear on long hostile strings', () => {
    const started = performance.now();
    for (const text of [
      'a'.repeat(200_000),
      `${'a.'.repeat(100_000)}@`,
      `a@${'b'.repeat(100_000)}`,
      `a@${'b.'.repeat(100_000)}`,
      'a@'.repeat(100_000),
      `${'a'.repeat(100_000)}@b.${'c'.repeat(100_000)}`,
    ]) {
      maskEmailAddresses(text);
    }
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
