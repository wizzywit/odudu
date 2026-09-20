import { describe, expect, it } from 'vitest';
import { frontChannelLogoutUrl } from '#/service/frontchannel-logout';

function parsed(
  registered: string,
  issuer: string,
  sessionId: string,
  sessionRequired: boolean,
): URL {
  const built = frontChannelLogoutUrl(registered, issuer, sessionId, sessionRequired);
  if (built === null) throw new Error(`expected a URL, got null for ${registered}`);
  return new URL(built);
}

describe('frontChannelLogoutUrl', () => {
  it('carries iss but no sid when the client did not register for it', () => {
    const url = parsed('https://rp.example/logout', 'https://issuer.example', 'session-1', false);
    expect(url.searchParams.get('iss')).toBe('https://issuer.example');
    expect(url.searchParams.has('sid')).toBe(false);
  });

  it('carries both iss and sid when the client registered frontchannel_logout_session_required', () => {
    const url = parsed('https://rp.example/logout', 'https://issuer.example', 'session-1', true);
    expect(url.searchParams.get('iss')).toBe('https://issuer.example');
    expect(url.searchParams.get('sid')).toBe('session-1');
  });

  it('keeps a query component the client registered, and adds to it', () => {
    const url = parsed(
      'https://rp.example/logout?tenant=a',
      'https://issuer.example',
      'session-1',
      false,
    );
    expect(url.searchParams.get('tenant')).toBe('a');
    expect(url.searchParams.get('iss')).toBe('https://issuer.example');
  });

  // Front-Channel Logout 1.0 §2's MUST: if either iss or sid is added, both
  // are added. Never demonstrated by a request that lacks iss altogether,
  // since this function has no such path — this is what makes that true.
  it('never carries sid without also carrying iss', () => {
    const url = parsed('https://rp.example/logout', 'https://issuer.example', 'session-1', true);
    expect(url.searchParams.has('sid')).toBe(true);
    expect(url.searchParams.has('iss')).toBe(true);
  });

  it('returns null for a stored value URL cannot parse, rather than throwing', () => {
    const built = frontChannelLogoutUrl(
      'not a url at all',
      'https://issuer.example',
      'session-1',
      false,
    );
    expect(built).toBeNull();
  });
});
