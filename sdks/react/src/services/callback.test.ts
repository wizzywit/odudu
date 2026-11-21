import { describe, expect, it } from 'vitest';
import { isCallback, withoutCallbackParams } from '#/services/callback';

describe('isCallback', () => {
  it('needs a state and a code or an error', () => {
    expect(isCallback('?code=a&state=b')).toBe(true);
    expect(isCallback('?error=access_denied&state=b')).toBe(true);
    expect(isCallback('?code=a')).toBe(false);
    expect(isCallback('?page=2')).toBe(false);
  });
});

describe('withoutCallbackParams', () => {
  it('drops what the issuer added and keeps the rest', () => {
    const href =
      'http://app.test/cb?tab=2&code=a&state=b&iss=https%3A%2F%2Fi&error=e&error_description=d#top';
    expect(withoutCallbackParams(href)).toBe('/cb?tab=2#top');
  });
});
