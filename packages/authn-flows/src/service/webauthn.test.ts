import { type RegistrationResponseJSON } from '@simplewebauthn/server';
import { domainAddress, pathAddress } from '@odudu/kernel';
import { softwareRegistrationResponse } from '@odudu/testkit';
import { describe, expect, it } from 'vitest';
import {
  canonicalRelyingParty,
  ceremonyRelyingParty,
  credentialRelyingPartyId,
  parseRegistrationResponse,
  passkeyAuthenticationOptions,
  passkeyRegistrationOptions,
  relyingPartyFor,
  relyingPartyId,
  verifyPasskeyRegistration,
} from '#/service/webauthn';

const PUBLIC_BASE_URL = 'http://localhost:3000';
const RP_ID = 'localhost';
const PATH_RP = relyingPartyFor(pathAddress(PUBLIC_BASE_URL, 'demo'));
const DOMAIN_RP = relyingPartyFor(domainAddress('login.acme.com', true));
const CHALLENGE = 'Zm9yLXJlZ2lzdHJhdGlvbi1vbmx5';
const REQUIRED = { userVerification: 'required', residentKey: 'required' } as const;

// A registration the software authenticator really signed, with the origin
// and the RP ID overridable one at a time. It goes through the same
// narrowing a browser's POST does, so a response the parse would refuse
// never reaches the verification.
function registrationFor(vary: { origin?: string; rpId?: string }): RegistrationResponseJSON {
  const parsed = parseRegistrationResponse(
    softwareRegistrationResponse({
      challenge: CHALLENGE,
      rpId: vary.rpId ?? RP_ID,
      origin: vary.origin ?? PUBLIC_BASE_URL,
    }),
  );
  if (parsed === null) throw new Error('expected the fixture to produce a registration response');
  return parsed;
}

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

describe('relyingPartyFor', () => {
  it('reads the id and origin off the address, whatever its path prefix', () => {
    expect(relyingPartyFor(pathAddress('https://id.example.com:8443', 'acme'))).toEqual({
      id: 'id.example.com',
      origin: 'https://id.example.com:8443',
    });
    expect(relyingPartyFor(domainAddress('login.acme.com', true))).toEqual({
      id: 'login.acme.com',
      origin: 'https://login.acme.com',
    });
    expect(relyingPartyFor(domainAddress('login.acme.test:8080', false))).toEqual({
      id: 'login.acme.test',
      origin: 'http://login.acme.test:8080',
    });
  });

  it('refuses an address literal, which no credential can be bound to', () => {
    expect(() => relyingPartyFor(pathAddress('http://127.0.0.1:3000', 'acme'))).toThrow(/address/);
    expect(() => relyingPartyFor(domainAddress('[::1]', false))).toThrow(/address/);
  });
});

describe('canonicalRelyingParty', () => {
  it('is the base host for a tenant with no canonical domain', () => {
    expect(canonicalRelyingParty(null, 'https://id.example.com')).toEqual({
      id: 'id.example.com',
      origin: 'https://id.example.com',
    });
  });

  it('is the canonical domain, over the base URL scheme, for one that has it', () => {
    expect(canonicalRelyingParty('login.acme.com', 'https://id.example.com')).toEqual({
      id: 'login.acme.com',
      origin: 'https://login.acme.com',
    });
    expect(canonicalRelyingParty('login.acme.test', 'http://localhost:3000').origin).toBe(
      'http://login.acme.test',
    );
  });
});

describe('passkeyRegistrationOptions', () => {
  it('[WEBAUTHN2-7.1.1-01] names the derived relying party and carries a challenge', async () => {
    const offer = await passkeyRegistrationOptions({
      relyingParty: relyingPartyFor(pathAddress('https://id.example.com:8443', 'demo')),
      tenantName: 'demo',
      username: 'ada',
      userHandle: '11111111-1111-1111-1111-111111111111',
      existingCredentialIds: [],
      policy: REQUIRED,
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
      relyingParty: relyingPartyFor(pathAddress('https://id.example.com', 'demo')),
      tenantName: 'demo',
      username: 'ada',
      userHandle: '11111111-1111-1111-1111-111111111111',
      existingCredentialIds: [],
      policy: REQUIRED,
    });

    expect(offer.options.authenticatorSelection).toMatchObject({
      residentKey: 'required',
      userVerification: 'required',
    });
  });

  it('asks for what the tenant’s policy says, not always for the strictest', async () => {
    const offer = await passkeyRegistrationOptions({
      relyingParty: relyingPartyFor(pathAddress('https://id.example.com', 'demo')),
      tenantName: 'demo',
      username: 'ada',
      userHandle: '11111111-1111-1111-1111-111111111111',
      existingCredentialIds: [],
      policy: { userVerification: 'preferred', residentKey: 'discouraged' },
    });

    expect(offer.options.authenticatorSelection).toMatchObject({
      residentKey: 'discouraged',
      userVerification: 'preferred',
    });
  });

  // Without this, a second enrolment on the same authenticator either
  // silently overwrites the first credential or fails in the browser with
  // nothing the server can explain.
  it('excludes the credentials the subject already has', async () => {
    const offer = await passkeyRegistrationOptions({
      relyingParty: relyingPartyFor(pathAddress('https://id.example.com', 'demo')),
      tenantName: 'demo',
      username: 'ada',
      userHandle: '11111111-1111-1111-1111-111111111111',
      existingCredentialIds: ['aaaa', 'bbbb'],
      policy: REQUIRED,
    });

    expect(offer.options.excludeCredentials?.map((credential) => credential.id)).toEqual([
      'aaaa',
      'bbbb',
    ]);
  });

  it('issues a different challenge every time', async () => {
    const input = {
      relyingParty: relyingPartyFor(pathAddress('https://id.example.com', 'demo')),
      tenantName: 'demo',
      username: 'ada',
      userHandle: '11111111-1111-1111-1111-111111111111',
      existingCredentialIds: [],
      policy: REQUIRED,
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
  it('[WEBAUTHN2-7.1.3-01] reports a rejection rather than throwing on a response that is not one', async () => {
    const outcome = await verifyPasskeyRegistration({
      relyingParty: PATH_RP,
      expectedChallenge: 'a-challenge',
      userVerification: 'required',
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

  // WebAuthn §7.1 steps 9 and 13 are two checks against two different
  // values — the origin the page was served from, and the domain the
  // credential is bound to — and an authenticator can get one right while
  // the other is wrong. Varied one at a time, so neither row rests on a
  // response that would have been refused for the other reason anyway.
  it('[WEBAUTHN2-7.1.9-01] refuses a registration whose client data names another origin', async () => {
    const outcome = await verifyPasskeyRegistration({
      relyingParty: PATH_RP,
      expectedChallenge: CHALLENGE,
      userVerification: 'required',
      response: registrationFor({ origin: 'https://attacker.example' }),
    });

    expect(outcome).toEqual({ kind: 'rejected' });
  });

  it("[WEBAUTHN2-7.1.13-01] refuses a registration signed over another relying party's id", async () => {
    const outcome = await verifyPasskeyRegistration({
      relyingParty: PATH_RP,
      expectedChallenge: CHALLENGE,
      userVerification: 'required',
      response: registrationFor({ rpId: 'attacker.example' }),
    });

    expect(outcome).toEqual({ kind: 'rejected' });
  });

  it('accepts the same response with both of those right', async () => {
    const outcome = await verifyPasskeyRegistration({
      relyingParty: PATH_RP,
      expectedChallenge: CHALLENGE,
      userVerification: 'required',
      response: registrationFor({}),
    });

    expect(outcome.kind).toBe('verified');
  });
});

describe('verifyPasskeyRegistration under a policy that does not require user verification', () => {
  const unverified = () => {
    const parsed = parseRegistrationResponse(
      softwareRegistrationResponse({
        challenge: CHALLENGE,
        rpId: RP_ID,
        origin: PUBLIC_BASE_URL,
        userVerified: false,
      }),
    );
    if (parsed === null) throw new Error('expected the fixture to produce a registration');
    return parsed;
  };

  it.each(['required'] as const)('refuses an unverified registration when %s', async (mode) => {
    const outcome = await verifyPasskeyRegistration({
      relyingParty: PATH_RP,
      expectedChallenge: CHALLENGE,
      userVerification: mode,
      response: unverified(),
    });
    expect(outcome).toEqual({ kind: 'rejected' });
  });

  it.each(['preferred', 'discouraged'] as const)(
    'accepts an unverified registration when %s',
    async (mode) => {
      const outcome = await verifyPasskeyRegistration({
        relyingParty: PATH_RP,
        expectedChallenge: CHALLENGE,
        userVerification: mode,
        response: unverified(),
      });
      expect(outcome.kind).toBe('verified');
    },
  );
});

describe('passkeyAuthenticationOptions', () => {
  it('requires user verification only where the tenant does', async () => {
    const required = await passkeyAuthenticationOptions(PATH_RP, 'required');
    const preferred = await passkeyAuthenticationOptions(PATH_RP, 'preferred');
    const discouraged = await passkeyAuthenticationOptions(PATH_RP, 'discouraged');
    expect(required.options.userVerification).toBe('required');
    expect(preferred.options.userVerification).toBe('preferred');
    // A key made without verification still signs in when the browser may verify.
    expect(discouraged.options.userVerification).toBe('preferred');
  });
});

describe('a passkey and the address it was registered at', () => {
  const authenticatorAt = (rp: { id: string; origin: string }) =>
    parseRegistrationResponse(
      softwareRegistrationResponse({ challenge: CHALLENGE, rpId: rp.id, origin: rp.origin }),
    );

  it('verifies at the address it was registered under and at no other', async () => {
    const atDomain = authenticatorAt(DOMAIN_RP);
    if (atDomain === null) throw new Error('expected the fixture to produce a registration');

    const at = (relyingParty: { id: string; origin: string }) =>
      verifyPasskeyRegistration({
        relyingParty,
        expectedChallenge: CHALLENGE,
        userVerification: 'required',
        response: atDomain,
      });

    expect((await at(DOMAIN_RP)).kind).toBe('verified');
    expect(await at(PATH_RP)).toEqual({ kind: 'rejected' });
  });

  it('is refused at the domain when it was registered at the path address, and again verifies there', async () => {
    const atPath = authenticatorAt(PATH_RP);
    if (atPath === null) throw new Error('expected the fixture to produce a registration');

    const at = (relyingParty: { id: string; origin: string }) =>
      verifyPasskeyRegistration({
        relyingParty,
        expectedChallenge: CHALLENGE,
        userVerification: 'required',
        response: atPath,
      });

    expect(await at(DOMAIN_RP)).toEqual({ kind: 'rejected' });
    expect((await at(PATH_RP)).kind).toBe('verified');
  });
});

describe('ceremonyRelyingParty', () => {
  it('is the base host for a tenant at the path address', () => {
    expect(ceremonyRelyingParty(null, 'https://id.example.com')).toEqual({
      id: 'id.example.com',
      origin: 'https://id.example.com',
    });
  });

  it('is the canonical domain for a tenant that has one', () => {
    expect(ceremonyRelyingParty('login.acme.com', 'https://id.example.com')).toEqual({
      id: 'login.acme.com',
      origin: 'https://login.acme.com',
    });
  });

  it('is nothing where there is no base URL', () => {
    expect(ceremonyRelyingParty(null, null)).toBeNull();
    expect(ceremonyRelyingParty('login.acme.com', null)).toBeNull();
  });

  it('is nothing at a path address whose base is an address literal', () => {
    for (const base of ['http://127.0.0.1:3000', 'http://[::1]:3000']) {
      expect(ceremonyRelyingParty(null, base), base).toBeNull();
    }
  });

  it('is the canonical domain even when the base is an address literal', () => {
    expect(ceremonyRelyingParty('login.acme.com', 'http://127.0.0.1:3000')).toEqual({
      id: 'login.acme.com',
      origin: 'http://login.acme.com',
    });
  });
});

describe('credentialRelyingPartyId', () => {
  it('keeps the id a passkey was stamped with', () => {
    expect(credentialRelyingPartyId('login.acme.com', 'https://id.example.com')).toBe(
      'login.acme.com',
    );
  });

  it('reads one not yet stamped as registered at the base host', () => {
    expect(credentialRelyingPartyId(null, 'https://id.example.com')).toBe('id.example.com');
  });

  it('is nothing without a base URL or with an address literal for one', () => {
    expect(credentialRelyingPartyId(null, null)).toBeNull();
    expect(credentialRelyingPartyId(null, 'http://127.0.0.1:3000')).toBeNull();
  });
});
