import { describe, expect, it } from 'vitest';
import {
  AUDIENCE_UNCHECKED,
  encodeUnsecuredJwt,
  generateSigningKey,
  signJwt,
  type SigningKeyRecord,
} from '@odudu/crypto';
import {
  subjectOfAuthorizeHint,
  subjectOfIdTokenHint,
  subjectOfLogoutHint,
} from '#/usecase/authorization-request';

const KEK = new Uint8Array(32).fill(3);
const ISS = 'https://issuer.example';
const CLIENT_ID = 'signing-client';

async function makeKey(): Promise<SigningKeyRecord> {
  const generated = await generateSigningKey('RS256', KEK);
  return {
    id: 'id-1',
    tenantId: 'tenant-1',
    kid: generated.kid,
    alg: generated.alg,
    status: 'active',
    publicJwk: generated.publicJwk,
    privateJwkEncrypted: generated.privateJwkEncrypted,
    createdAt: new Date(),
    notAfter: null,
  };
}

// C1 (task-36 review): a signed UserInfo response — no `typ`, no `exp`, a
// correct `iss`/`aud`/`sub`, signed by a publishable key — used to satisfy
// this exact reader, minting a never-expiring `id_token_hint`. Both closes
// checked here: the missing `exp` alone refuses it, and the `typ` this
// server now gives that response refuses it independently of `exp`.
describe('subjectOfIdTokenHint refuses a signed UserInfo response', () => {
  it('refuses a userinfo-shaped payload carrying the userinfo+jwt typ and no exp', async () => {
    const key = await makeKey();
    const userinfoResponse = await signJwt(
      { sub: 'user-1', email: 'alice@example.com', iss: ISS, aud: CLIENT_ID },
      { key, kek: KEK, typ: 'userinfo+jwt' },
    );

    const result = await subjectOfIdTokenHint(
      { listPublishableKeys: () => Promise.resolve([key]) },
      'tenant-1',
      [ISS],
      userinfoResponse,
      AUDIENCE_UNCHECKED,
    );

    expect(result).toBeNull();
  });

  // Isolates the `exp` half: even a payload that (hypothetically) carried
  // no typ at all is refused once `exp` is required, so the fix does not
  // depend solely on every signed UserInfo response remembering its typ.
  it('refuses a typ-less payload with no exp, on exp alone', async () => {
    const key = await makeKey();
    const noTypPayload = await signJwt(
      { sub: 'user-2', iss: ISS, aud: CLIENT_ID },
      { key, kek: KEK },
    );

    const result = await subjectOfIdTokenHint(
      { listPublishableKeys: () => Promise.resolve([key]) },
      'tenant-1',
      [ISS],
      noTypPayload,
      AUDIENCE_UNCHECKED,
    );

    expect(result).toBeNull();
  });

  it('still accepts a genuine ID Token: no typ, a real exp', async () => {
    const key = await makeKey();
    const exp = Math.floor(Date.now() / 1000) + 300;
    const idToken = await signJwt(
      {
        sub: 'user-3',
        iss: ISS,
        aud: CLIENT_ID,
        exp,
      },
      { key, kek: KEK },
    );

    const result = await subjectOfIdTokenHint(
      { listPublishableKeys: () => Promise.resolve([key]) },
      'tenant-1',
      [ISS],
      idToken,
      AUDIENCE_UNCHECKED,
    );

    expect(result).toEqual({
      subject: 'user-3',
      sid: null,
      audiences: [CLIENT_ID],
      mayAct: undefined,
      expiresAt: new Date(exp * 1000),
    });
  });

  // The `none` case never reaches this far: jose refuses to verify an
  // unsecured JWT at all (docs/protocols/oidc-core.md's reading note), so
  // this is the shape, not a trust decision.
  it('refuses an unsecured (alg: none) userinfo response outright', async () => {
    const key = await makeKey();
    const unsecured = encodeUnsecuredJwt({ sub: 'user-4', iss: ISS, aud: CLIENT_ID });

    const result = await subjectOfIdTokenHint(
      { listPublishableKeys: () => Promise.resolve([key]) },
      'tenant-1',
      [ISS],
      unsecured,
      AUDIENCE_UNCHECKED,
    );

    expect(result).toBeNull();
  });
});

// RP-Initiated Logout 1.0 §2: the logout door alone reads a hint whose
// `exp` has passed. Every other claim is judged as `subjectOfIdTokenHint`
// judges it, and that function itself keeps refusing the same token.
describe('subjectOfLogoutHint reads a lapsed hint', () => {
  const YEARS_AGO = Math.floor(Date.now() / 1000) - 3 * 365 * 24 * 3600;

  async function lapsed(
    key: SigningKeyRecord,
    claims: Record<string, unknown> = {},
    typ?: string,
  ): Promise<string> {
    return signJwt(
      { sub: 'user-9', sid: 'sid-9', iss: ISS, aud: CLIENT_ID, exp: YEARS_AGO, ...claims },
      { key, kek: KEK, ...(typ === undefined ? {} : { typ }) },
    );
  }

  const read = (key: SigningKeyRecord, token: string) =>
    subjectOfLogoutHint({ listPublishableKeys: () => Promise.resolve([key]) }, 't', [ISS], token);

  it('returns the claims of a hint that expired years ago', async () => {
    const key = await makeKey();
    expect(await read(key, await lapsed(key))).toEqual({
      subject: 'user-9',
      sid: 'sid-9',
      audiences: [CLIENT_ID],
      mayAct: undefined,
      expiresAt: new Date(YEARS_AGO * 1000),
    });
  });

  it('is the only reader that does: subjectOfIdTokenHint refuses the same token', async () => {
    const key = await makeKey();
    const token = await lapsed(key);
    const result = await subjectOfIdTokenHint(
      { listPublishableKeys: () => Promise.resolve([key]) },
      't',
      [ISS],
      token,
      AUDIENCE_UNCHECKED,
    );
    expect(result).toBeNull();
  });

  it.each([
    ['a wrong issuer', (key: SigningKeyRecord) => lapsed(key, { iss: 'https://other.example' })],
    ['an explicit typ', (key: SigningKeyRecord) => lapsed(key, {}, 'at+jwt')],
    ['no sub', (key: SigningKeyRecord) => lapsed(key, { sub: undefined })],
    ['an empty sub', (key: SigningKeyRecord) => lapsed(key, { sub: '' })],
    ['no exp', (key: SigningKeyRecord) => lapsed(key, { exp: undefined })],
    ['alg none', () => Promise.resolve(encodeUnsecuredJwt({ sub: 'u', iss: ISS, exp: 1 }))],
  ])('refuses a lapsed hint with %s', async (_name, make) => {
    const key = await makeKey();
    expect(await read(key, await make(key))).toBeNull();
  });

  describe('a tenant that moved to another address', () => {
    const PREVIOUS = 'https://old.example/tenants/acme';

    it('reads a hint minted under a retired issuer while it is accepted, and not after', async () => {
      const key = await makeKey();
      const token = await lapsed(key, { iss: PREVIOUS });
      const deps = { listPublishableKeys: () => Promise.resolve([key]) };
      expect(await subjectOfLogoutHint(deps, 't', [ISS, PREVIOUS], token)).not.toBeNull();
      expect(
        await subjectOfAuthorizeHint(deps, 't', [ISS, PREVIOUS], token, CLIENT_ID),
      ).not.toBeNull();
      expect(await subjectOfLogoutHint(deps, 't', [ISS], token)).toBeNull();
      expect(await subjectOfAuthorizeHint(deps, 't', [ISS], token, CLIENT_ID)).toBeNull();
    });
  });

  it('refuses a lapsed hint signed by a key this tenant does not publish', async () => {
    const key = await makeKey();
    const stranger = await makeKey();
    expect(await read(key, await lapsed(stranger))).toBeNull();
  });
});
