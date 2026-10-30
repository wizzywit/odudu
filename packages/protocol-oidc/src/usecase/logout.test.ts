import { describe, expect, it } from 'vitest';
import { MAX_FRONT_CHANNEL_FRAMES } from '#/service/frontchannel-logout';
import {
  decideLogout,
  decideRedirect,
  frontChannelLogoutUrls,
  registeredRedirectOf,
  toValidHint,
} from '#/usecase/logout';

const registered = ['https://app.example/after-logout'];
const live = { id: 's1' };
const ownHint = { clientId: 'rp', sid: 's1' };
const skipping = { id: 'rp', skipsConfirmation: true };
const asking = { id: 'rp', skipsConfirmation: false };
const redirect = { uri: 'https://app.example/after-logout' };

describe('decideLogout', () => {
  it('a client with the setting on signs out at once for its own valid hint', () => {
    expect(decideLogout({ session: live, hint: ownHint, client: skipping, redirect })).toEqual({
      kind: 'end',
      sessionEnds: true,
    });
  });

  it('asks with no hint, even with client_id', () => {
    expect(decideLogout({ session: live, hint: null, client: skipping, redirect })).toEqual({
      kind: 'confirm',
    });
  });

  it('asks for an invalid hint', () => {
    // A hint that did not verify, was another issuer's, or named several
    // audiences reaches the decision as no hint at all.
    expect(decideLogout({ session: live, hint: null, client: skipping, redirect: null })).toEqual({
      kind: 'confirm',
    });
  });

  it('asks for a hint minted for another client, even when this client skips', () => {
    expect(
      decideLogout({
        session: live,
        hint: { clientId: 'other', sid: 's1' },
        client: skipping,
        redirect,
      }),
    ).toEqual({ kind: 'confirm' });
  });

  it("asks when the hint's sid is not the live session", () => {
    expect(
      decideLogout({
        session: live,
        hint: { clientId: 'rp', sid: 'another-session' },
        client: skipping,
        redirect,
      }),
    ).toEqual({ kind: 'confirm' });
  });

  it('asks for every client with the setting off', () => {
    expect(decideLogout({ session: live, hint: ownHint, client: asking, redirect })).toEqual({
      kind: 'confirm',
    });
  });

  it('asks when the request names no client the server knows', () => {
    expect(decideLogout({ session: live, hint: ownHint, client: null, redirect })).toEqual({
      kind: 'confirm',
    });
  });

  describe('with no live session', () => {
    it('confirms (nothing to end, no redirect requested)', () => {
      expect(decideLogout({ session: null, hint: null, client: asking, redirect: null })).toEqual({
        kind: 'confirm',
      });
    });

    it('no session with a registered redirect still ends', () => {
      // §3 forbids redirecting to an *unmatched* URI; it says nothing
      // against honouring a matched one when there is nothing to end — an
      // RP sending a user to logout after their session already idled out
      // must not be stranded with no way back.
      expect(decideLogout({ session: null, hint: null, client: asking, redirect })).toEqual({
        kind: 'end',
        sessionEnds: false,
        redirectTo: 'https://app.example/after-logout',
      });
    });

    it('does not end for a skipping client either: there is no session to match the hint to', () => {
      expect(
        decideLogout({ session: null, hint: ownHint, client: skipping, redirect: null }),
      ).toEqual({ kind: 'confirm' });
    });
  });
});

describe('toValidHint', () => {
  it('names the one audience and the sid of a hint that verified', () => {
    expect(toValidHint({ audiences: ['rp'], sid: 's1' })).toEqual({ clientId: 'rp', sid: 's1' });
  });

  it('is no hint when it names several audiences', () => {
    expect(toValidHint({ audiences: ['rp', 'other'], sid: 's1' })).toBeNull();
  });

  it('is no hint when it names no audience', () => {
    expect(toValidHint({ audiences: [], sid: 's1' })).toBeNull();
  });

  it('is no hint when it carries no sid', () => {
    expect(toValidHint({ audiences: ['rp'], sid: null })).toBeNull();
  });

  it('is no hint when the reader rejected it, another issuer’s or one with a bad signature', () => {
    expect(toValidHint(null)).toBeNull();
  });
});

describe('registeredRedirectOf', () => {
  it('matches a registered address exactly and nothing else', () => {
    expect(registeredRedirectOf('https://app.example/after-logout', registered)).toEqual({
      uri: 'https://app.example/after-logout',
    });
    expect(registeredRedirectOf('https://app.example/after-logout/', registered)).toBeNull();
    expect(registeredRedirectOf(null, registered)).toBeNull();
  });
});

describe('frontChannelLogoutUrls', () => {
  it('asks for no more than the frame bound, and builds a URL per client', async () => {
    const asked: number[] = [];
    const urls = await frontChannelLogoutUrls(
      {
        frontChannelClientsForSession: (_tenant, _session, limit) => {
          asked.push(limit);
          return Promise.resolve([
            {
              frontchannelLogoutUri: 'https://rp.example/logout',
              frontchannelLogoutSessionRequired: true,
            },
          ]);
        },
      },
      'tenant',
      'https://issuer.example',
      's1',
    );
    expect(asked).toEqual([MAX_FRONT_CHANNEL_FRAMES]);
    expect(urls).toHaveLength(1);
  });
});

describe('decideRedirect', () => {
  it('ends at an exactly matching registered uri', () => {
    expect(decideRedirect('https://app.example/after-logout', registered)).toEqual({
      kind: 'end',
      redirectTo: 'https://app.example/after-logout',
    });
  });

  it('ends with no redirect when none was requested', () => {
    expect(decideRedirect(null, registered)).toEqual({ kind: 'end', redirectTo: null });
  });

  it.each([
    ['https://app.example/after-logout/'],
    ['https://app.example/after-logout?x=1'],
    ['https://APP.example/after-logout'],
    ['https://evil.example/after-logout'],
  ])('renders rather than redirecting to %s', (requested) => {
    expect(decideRedirect(requested, registered)).toEqual({
      kind: 'render',
      error: 'invalid_request',
    });
  });
});
