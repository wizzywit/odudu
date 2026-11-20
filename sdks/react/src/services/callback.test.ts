import { describe, expect, it } from 'vitest';
import { isCallback, withoutCallbackParams } from '#/services/callback';

describe('isCallback', () => {
  it('needs a sign-in under way and a code or an error', () => {
    expect(isCallback('?code=a&state=b', true)).toBe(true);
    expect(isCallback('?error=access_denied&state=b', true)).toBe(true);
    expect(isCallback('?code=a&state=b', false)).toBe(false);
    expect(isCallback('?page=2', true)).toBe(false);
  });
});

describe('withoutCallbackParams', () => {
  it('drops what the issuer added and keeps the rest', () => {
    const href =
      'http://app.test/cb?tab=2&code=a&state=b&iss=https%3A%2F%2Fi&error=e&error_description=d#top';
    expect(withoutCallbackParams(href)).toBe('/cb?tab=2#top');
  });
});
