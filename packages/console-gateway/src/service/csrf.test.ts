import { describe, expect, it } from 'vitest';
import { csrfRefusal } from '#/service/csrf';

const ORIGIN = 'https://console.example.test';
const GOOD = { origin: ORIGIN, 'x-odudu-console': '1' };

describe('csrfRefusal', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('lets %s through with no headers at all', (method) => {
    expect(csrfRefusal({ method, headers: {} }, ORIGIN)).toBeNull();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'post'])(
    'lets %s through with the origin and the console header',
    (method) => {
      expect(csrfRefusal({ method, headers: GOOD }, ORIGIN)).toBeNull();
    },
  );

  it.each([
    ['no Origin', { 'x-odudu-console': '1' }, 'origin-missing'],
    ['another origin', { ...GOOD, origin: 'https://evil.example' }, 'origin-mismatch'],
    ['a sibling origin', { ...GOOD, origin: 'https://a.console.example.test' }, 'origin-mismatch'],
    [
      'the origin over another scheme',
      { ...GOOD, origin: 'http://console.example.test' },
      'origin-mismatch',
    ],
    ['the opaque origin', { ...GOOD, origin: 'null' }, 'origin-mismatch'],
    ['Origin given twice', { ...GOOD, origin: [ORIGIN, ORIGIN] }, 'origin-mismatch'],
    ['no console header', { origin: ORIGIN }, 'console-header-missing'],
    [
      'a console header of another value',
      { ...GOOD, 'x-odudu-console': 'true' },
      'console-header-missing',
    ],
    [
      'the console header twice',
      { ...GOOD, 'x-odudu-console': ['1', '1'] },
      'console-header-missing',
    ],
  ])('refuses a POST with %s', (_label, headers, reason) => {
    expect(csrfRefusal({ method: 'POST', headers }, ORIGIN)).toBe(reason);
  });
});
