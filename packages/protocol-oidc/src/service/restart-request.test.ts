import { type PendingRequest } from '@odudu/authn-flows';
import { describe, expect, it } from 'vitest';
import { parseClaimsRequest } from '#/service/claims-request';
import { restartAuthorizeLocation } from '#/service/restart-request';
import { pathAddress } from '@odudu/kernel';

const PENDING: PendingRequest = {
  clientId: 'web app',
  redirectUri: 'https://app.example/cb?x=1',
  scope: 'openid profile',
  state: 'a b&c',
  nonce: 'n-1',
  codeChallenge: 'c'.repeat(43),
  codeChallengeMethod: 'S256',
};

const parse = (location: string | null): URL => {
  if (location === null) throw new Error('expected a location');
  return new URL(location, 'https://server.example');
};

describe('restartAuthorizeLocation', () => {
  it('points at this tenant’s own authorize endpoint, as a path with no origin', () => {
    const location = restartAuthorizeLocation(pathAddress('https://idp.example', 'acme'), PENDING);
    expect(location?.startsWith('/tenants/acme/protocol/openid-connect/auth?')).toBe(true);
  });

  it('encodes the tenant name into the path', () => {
    const location = restartAuthorizeLocation(pathAddress('https://idp.example', 'a/b?c'), PENDING);
    expect(parse(location).pathname).toBe('/tenants/a%2Fb%3Fc/protocol/openid-connect/auth');
  });

  it('rebuilds the request the client sent, each value encoded', () => {
    const url = parse(
      restartAuthorizeLocation(pathAddress('https://idp.example', 'acme'), PENDING),
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'web app',
      redirect_uri: 'https://app.example/cb?x=1',
      scope: 'openid profile',
      state: 'a b&c',
      nonce: 'n-1',
      code_challenge: 'c'.repeat(43),
      code_challenge_method: 'S256',
    });
  });

  it('leaves out what the request never carried', () => {
    const url = parse(
      restartAuthorizeLocation(pathAddress('https://idp.example', 'acme'), {
        ...PENDING,
        state: null,
        nonce: null,
      }),
    );
    expect(url.searchParams.has('state')).toBe(false);
    expect(url.searchParams.has('nonce')).toBe(false);
    expect(url.searchParams.has('prompt')).toBe(false);
    expect(url.searchParams.has('max_age')).toBe(false);
    expect(url.searchParams.has('claims')).toBe(false);
    expect(url.searchParams.has('resource')).toBe(false);
  });

  it('rebuilds ui_locales from the parked request', () => {
    const url = parse(
      restartAuthorizeLocation(pathAddress('https://idp.example', 'acme'), {
        ...PENDING,
        uiLocales: ['fr-CA', 'fr', 'en'],
      }),
    );
    expect(url.searchParams.get('ui_locales')).toBe('fr-CA fr en');
  });

  it('rebuilds without ui_locales when the request carried none', () => {
    expect(
      parse(
        restartAuthorizeLocation(pathAddress('https://idp.example', 'acme'), PENDING),
      ).searchParams.has('ui_locales'),
    ).toBe(false);
    expect(
      parse(
        restartAuthorizeLocation(pathAddress('https://idp.example', 'acme'), {
          ...PENDING,
          uiLocales: [],
        }),
      ).searchParams.has('ui_locales'),
    ).toBe(false);
  });

  // A request parked under prompt=create is rebuilt once the person has an
  // account: the way back is a sign-in, and one that asks for credentials
  // rather than reusing whichever session the browser already holds.
  it('rebuilds prompt=create as prompt=login', () => {
    const url = parse(
      restartAuthorizeLocation(pathAddress('https://idp.example', 'acme'), {
        ...PENDING,
        prompt: ['create'],
      }),
    );
    expect(url.searchParams.get('prompt')).toBe('login');
  });

  it('carries prompt, max_age and a single resource', () => {
    const url = parse(
      restartAuthorizeLocation(pathAddress('https://idp.example', 'acme'), {
        ...PENDING,
        prompt: ['login', 'consent'],
        maxAge: 0,
        resource: ['https://api.example'],
      }),
    );
    expect(url.searchParams.get('prompt')).toBe('login consent');
    expect(url.searchParams.get('max_age')).toBe('0');
    expect(url.searchParams.getAll('resource')).toEqual(['https://api.example']);
  });

  // Several resolved audiences mean the client sent none and the registered
  // list applied; naming two would be refused as invalid_target.
  it('omits resource when more than one audience was resolved', () => {
    const url = parse(
      restartAuthorizeLocation(pathAddress('https://idp.example', 'acme'), {
        ...PENDING,
        resource: ['https://a', 'https://b'],
      }),
    );
    expect(url.searchParams.has('resource')).toBe(false);
  });

  it('rebuilds a claims parameter that parses back to the one parked', () => {
    const claims = {
      idToken: { email: { essential: true }, acr: { essential: false, values: ['a', 'b'] } },
      userinfo: { name: { essential: false, value: 'x' } },
    };
    const url = parse(
      restartAuthorizeLocation(pathAddress('https://idp.example', 'acme'), { ...PENDING, claims }),
    );
    const raw = url.searchParams.get('claims') ?? undefined;
    expect(parseClaimsRequest(raw)).toEqual({ kind: 'ok', request: claims });
  });

  // The hint token itself is not stored, only whom it named; a request
  // rebuilt without it would let anybody sign in where the original
  // demanded one subject.
  it('asks again for an action that has not ended, and not for one that has', () => {
    const address = pathAddress('https://idp.example', 'acme');
    const asked = parse(
      restartAuthorizeLocation(address, { ...PENDING, action: 'configure-totp' }),
    );
    expect(asked.searchParams.get('action')).toBe('configure-totp');
    const ended = parse(
      restartAuthorizeLocation(address, {
        ...PENDING,
        action: 'configure-totp',
        actionStatus: 'cancelled',
      }),
    );
    expect(ended.searchParams.has('action')).toBe(false);
    expect(parse(restartAuthorizeLocation(address, PENDING)).searchParams.has('action')).toBe(
      false,
    );
  });

  it('refuses to rebuild a request that was constrained to one subject', () => {
    expect(
      restartAuthorizeLocation(pathAddress('https://idp.example', 'acme'), {
        ...PENDING,
        idTokenHintSubject: 's',
      }),
    ).toBeNull();
    expect(
      restartAuthorizeLocation(pathAddress('https://idp.example', 'acme'), {
        ...PENDING,
        claimsSubject: 's',
      }),
    ).toBeNull();
  });

  it('refuses a claims parameter /authorize would refuse for its size', () => {
    const entry = { essential: false, value: 'v'.repeat(9000) };
    const claims = { idToken: { email: entry }, userinfo: {} };
    expect(
      restartAuthorizeLocation(pathAddress('https://idp.example', 'acme'), { ...PENDING, claims }),
    ).toBeNull();
  });
});
