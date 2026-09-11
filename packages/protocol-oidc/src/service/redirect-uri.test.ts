import { describe, expect, it } from 'vitest';
import { isRegisteredRedirectUri } from '#/service/redirect-uri';

const REGISTERED = ['https://app.example/callback'];

describe('[OIDC-CORE-3.1.2.1-06] isRegisteredRedirectUri', () => {
  it('matches the exact registered string', () => {
    expect(isRegisteredRedirectUri('https://app.example/callback', REGISTERED)).toBe(true);
  });

  it('rejects a trailing slash the client added', () => {
    expect(isRegisteredRedirectUri('https://app.example/callback/', REGISTERED)).toBe(false);
  });

  it('rejects a path-case change', () => {
    expect(isRegisteredRedirectUri('https://app.example/Callback', REGISTERED)).toBe(false);
  });

  it('rejects an extra query parameter', () => {
    expect(isRegisteredRedirectUri('https://app.example/callback?x=1', REGISTERED)).toBe(false);
  });

  it('rejects a URI absent from the registered list entirely', () => {
    expect(isRegisteredRedirectUri('https://evil.example/cb', REGISTERED)).toBe(false);
  });
});
