import { describe, expect, it } from 'vitest';
import { registeredReturn, returnHref } from '#/service/return-link';

describe('returnHref', () => {
  it('adds the ending to a registered address', () => {
    expect(returnHref('https://app.example/cb', 'success')).toBe(
      'https://app.example/cb?action_status=success',
    );
    expect(returnHref('https://app.example/cb', 'error')).toBe(
      'https://app.example/cb?action_status=error',
    );
  });

  it('keeps the query the client registered and replaces a status already in it', () => {
    expect(returnHref('https://app.example/cb?tab=security', 'success')).toBe(
      'https://app.example/cb?tab=security&action_status=success',
    );
    expect(returnHref('https://app.example/cb?action_status=error', 'success')).toBe(
      'https://app.example/cb?action_status=success',
    );
  });

  it('serves a native application scheme the same way', () => {
    expect(returnHref('com.example.app:/cb', 'success')).toBe(
      'com.example.app:/cb?action_status=success',
    );
  });

  it('offers nothing for an address that cannot be read', () => {
    expect(returnHref('not a uri', 'success')).toBeNull();
    expect(returnHref(null, 'success')).toBeNull();
    expect(returnHref(undefined, 'error')).toBeNull();
  });
});

describe('registeredReturn', () => {
  const client = {
    enabled: true,
    redirectUris: ['https://app.example/a', 'https://app.example/b'],
  };

  it('keeps the address while the client is enabled and registers it exactly', () => {
    expect(registeredReturn(client, 'https://app.example/b')).toBe('https://app.example/b');
  });

  it.each([
    ['a client that is gone', null, 'https://app.example/a'],
    ['a disabled client', { ...client, enabled: false }, 'https://app.example/a'],
    ['an address no longer registered', client, 'https://app.example/c'],
    ['an address that only starts like one', client, 'https://app.example/a/more'],
  ] as const)('drops it for %s', (_name, state, uri) => {
    expect(registeredReturn(state, uri)).toBeNull();
  });
});
