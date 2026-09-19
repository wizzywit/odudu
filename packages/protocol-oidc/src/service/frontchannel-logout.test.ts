import { describe, expect, it } from 'vitest';
import { frontChannelLogoutUrl } from '#/service/frontchannel-logout';

describe('frontChannelLogoutUrl', () => {
  it('carries iss but no sid when the client did not register for it', () => {
    const url = new URL(
      frontChannelLogoutUrl(
        'https://rp.example/logout',
        'https://issuer.example',
        'session-1',
        false,
      ),
    );
    expect(url.searchParams.get('iss')).toBe('https://issuer.example');
    expect(url.searchParams.has('sid')).toBe(false);
  });

  it('carries both iss and sid when the client registered frontchannel_logout_session_required', () => {
    const url = new URL(
      frontChannelLogoutUrl(
        'https://rp.example/logout',
        'https://issuer.example',
        'session-1',
        true,
      ),
    );
    expect(url.searchParams.get('iss')).toBe('https://issuer.example');
    expect(url.searchParams.get('sid')).toBe('session-1');
  });

  it('keeps a query component the client registered, and adds to it', () => {
    const url = new URL(
      frontChannelLogoutUrl(
        'https://rp.example/logout?tenant=a',
        'https://issuer.example',
        'session-1',
        false,
      ),
    );
    expect(url.searchParams.get('tenant')).toBe('a');
    expect(url.searchParams.get('iss')).toBe('https://issuer.example');
  });
});
