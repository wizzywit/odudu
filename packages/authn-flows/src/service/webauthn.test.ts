import { describe, expect, it } from 'vitest';
import {
  passkeyRegistrationOptions,
  relyingPartyId,
  relyingPartyOrigin,
  verifyPasskeyRegistration,
} from '#/service/webauthn';

describe('relyingPartyId', () => {
  it('is the host of the configured public base URL, without the port', () => {
    expect(relyingPartyId('https://id.example.com')).toBe('id.example.com');
    expect(relyingPartyId('https://id.example.com:8443')).toBe('id.example.com');
    expect(relyingPartyId('http://localhost:8080')).toBe('localhost');
  });

  it('throws on a base URL that is not one, rather than defaulting', () => {
    expect(() => relyingPartyId('')).toThrow();
    expect(() => relyingPartyId('not a url')).toThrow();
  });

  // A credential is bound to the RP ID it was created against, and a browser
  // silently declines to offer one whose RP ID does not match the page it is
  // on. There is nothing sensible to fall back to, so there is no fallback.
  it('refuses a scheme that could never be a WebAuthn origin', () => {
    expect(() => relyingPartyId('ftp://id.example.com')).toThrow();
  });

  // An RP ID is compared as a domain, so a browser can never match a
  // credential against an address literal — a passkey registered against
  // one is unusable from the moment it exists, which is exactly what the
  // boot guard is there to prevent.
  it('refuses an address literal, IPv4 or IPv6', () => {
    expect(() => relyingPartyId('http://127.0.0.1:3000')).toThrow(/address/);
    expect(() => relyingPartyId('https://10.0.0.7')).toThrow(/address/);
    expect(() => relyingPartyId('http://[::1]:3000')).toThrow(/address/);
  });
});

describe('relyingPartyOrigin', () => {
  // The origin keeps the port the RP ID drops: a response's clientDataJSON
  // names the full origin, and http://localhost:8080 is not http://localhost.
  it('keeps the port and drops everything after the host', () => {
    expect(relyingPartyOrigin('http://localhost:8080')).toBe('http://localhost:8080');
    expect(relyingPartyOrigin('https://id.example.com/')).toBe('https://id.example.com');
  });

  it('throws on a base URL that is not one', () => {
    expect(() => relyingPartyOrigin('')).toThrow();
  });
});

describe('passkeyRegistrationOptions', () => {
  it('names the derived relying party and carries a challenge', async () => {
    const offer = await passkeyRegistrationOptions({
      publicBaseUrl: 'https://id.example.com:8443',
      realmName: 'demo',
      username: 'ada',
      userHandle: '11111111-1111-1111-1111-111111111111',
      existingCredentialIds: [],
    });

    expect(offer.options.rp.id).toBe('id.example.com');
    expect(offer.options.challenge).toBe(offer.challenge);
    expect(offer.challenge.length).toBeGreaterThan(0);
    expect(offer.options.user.name).toBe('ada');
  });

  // Required, not the library's "preferred" defaults. A passkey stands
  // alone as a factor that counts as two, which holds only if the
  // authenticator verified the person; and a credential that is not
  // discoverable cannot answer an assertion naming no username. Neither
  // can be fixed after the credential exists.
  it('requires user verification and a discoverable credential', async () => {
    const offer = await passkeyRegistrationOptions({
      publicBaseUrl: 'https://id.example.com',
      realmName: 'demo',
      username: 'ada',
      userHandle: '11111111-1111-1111-1111-111111111111',
      existingCredentialIds: [],
    });

    expect(offer.options.authenticatorSelection).toMatchObject({
      residentKey: 'required',
      userVerification: 'required',
    });
  });

  // Without this, a second enrolment on the same authenticator either
  // silently overwrites the first credential or fails in the browser with
  // nothing the server can explain.
  it('excludes the credentials the subject already has', async () => {
    const offer = await passkeyRegistrationOptions({
      publicBaseUrl: 'https://id.example.com',
      realmName: 'demo',
      username: 'ada',
      userHandle: '11111111-1111-1111-1111-111111111111',
      existingCredentialIds: ['aaaa', 'bbbb'],
    });

    expect(offer.options.excludeCredentials?.map((credential) => credential.id)).toEqual([
      'aaaa',
      'bbbb',
    ]);
  });

  it('issues a different challenge every time', async () => {
    const input = {
      publicBaseUrl: 'https://id.example.com',
      realmName: 'demo',
      username: 'ada',
      userHandle: '11111111-1111-1111-1111-111111111111',
      existingCredentialIds: [],
    };
    const first = await passkeyRegistrationOptions(input);
    const second = await passkeyRegistrationOptions(input);

    expect(first.challenge).not.toBe(second.challenge);
  });
});

describe('verifyPasskeyRegistration', () => {
  // The library throws on a response it cannot verify rather than returning
  // verified: false for every case. A thrown error here is a rejected
  // enrolment, not a 500, so it is caught and reported as one.
  it('reports a rejection rather than throwing on a response that is not one', async () => {
    const outcome = await verifyPasskeyRegistration({
      publicBaseUrl: 'http://localhost:3000',
      expectedChallenge: 'a-challenge',
      response: {
        id: 'nope',
        rawId: 'nope',
        response: { clientDataJSON: 'bm90LWpzb24', attestationObject: 'bm90LWNib3I' },
        clientExtensionResults: {},
        type: 'public-key',
      },
    });

    expect(outcome).toEqual({ kind: 'rejected' });
  });
});
