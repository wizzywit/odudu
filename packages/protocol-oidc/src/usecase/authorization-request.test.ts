import { describe, expect, it } from 'vitest';
import {
  AUDIENCE_UNCHECKED,
  encodeUnsecuredJwt,
  generateSigningKey,
  signJwt,
  type SigningKeyRecord,
} from '@odudu/crypto';
import { subjectOfIdTokenHint } from '#/usecase/authorization-request';

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
      ISS,
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
      ISS,
      noTypPayload,
      AUDIENCE_UNCHECKED,
    );

    expect(result).toBeNull();
  });

  it('still accepts a genuine ID Token: no typ, a real exp', async () => {
    const key = await makeKey();
    const idToken = await signJwt(
      {
        sub: 'user-3',
        iss: ISS,
        aud: CLIENT_ID,
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      { key, kek: KEK },
    );

    const result = await subjectOfIdTokenHint(
      { listPublishableKeys: () => Promise.resolve([key]) },
      'tenant-1',
      ISS,
      idToken,
      AUDIENCE_UNCHECKED,
    );

    expect(result).toEqual({ subject: 'user-3', sid: null, audiences: [CLIENT_ID] });
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
      ISS,
      unsecured,
      AUDIENCE_UNCHECKED,
    );

    expect(result).toBeNull();
  });
});
