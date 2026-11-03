import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserStorage } from '#/shared/api/adapter/browserStorage';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('browserStorage', () => {
  it('returns the local or the session storage by kind', () => {
    expect(browserStorage('local')).toBe(window.localStorage);
    expect(browserStorage('session')).toBe(window.sessionStorage);
  });

  it('returns undefined when the getter refuses', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(browserStorage('local')).toBeUndefined();
    expect(browserStorage('session')).toBeUndefined();
  });
});
