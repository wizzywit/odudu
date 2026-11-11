import { generateSigningKey, signJwt, type SigningKeyRecord } from '@odudu/crypto';
import { meAudienceOfIssuer } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { resolveUserinfo, type UserinfoDeps } from '#/usecase/userinfo';

const ISSUER = 'https://idp.example/tenants/acme';
const KEK = Buffer.alloc(32, 3);
const NOW = new Date();

async function key(): Promise<SigningKeyRecord> {
  const generated = await generateSigningKey('ES256', KEK);
  return {
    id: 'key-id',
    tenantId: 'tenant-1',
    status: 'active',
    createdAt: new Date(0),
    notAfter: null,
    ...generated,
  };
}

// Only what the checks before the grant lookup read; a token that is refused
// there never reaches the rest.
function depsWith(signing: SigningKeyRecord, loaded: string[]): UserinfoDeps {
  return {
    findTenant: () => Promise.resolve({ id: 'tenant-1', enabled: true }),
    listPublishableKeys: () => Promise.resolve([signing]),
    acceptedIssuers: () => Promise.resolve([ISSUER]),
    loadGrant: (_tenant: string, grantId: string) => {
      loaded.push(grantId);
      return Promise.resolve({ revokedAt: new Date(0) });
    },
  } as unknown as UserinfoDeps;
}

async function present(aud: string[]) {
  const signing = await key();
  const iat = Math.floor(NOW.getTime() / 1000);
  const token = await signJwt(
    {
      iss: ISSUER,
      sub: 'subject-1',
      aud,
      iat,
      exp: iat + 300,
      client_id: 'app',
      grant_id: 'grant-1',
      scope: 'openid me:read',
    },
    { key: signing, kek: KEK, typ: 'at+jwt' },
  );
  const loaded: string[] = [];
  const outcome = await resolveUserinfo(
    depsWith(signing, loaded),
    'acme',
    ISSUER,
    `Bearer ${token}`,
    undefined,
    NOW,
  );
  return { outcome, grantLoaded: loaded.length > 0 };
}

describe('a token for the "me" API at /userinfo', () => {
  it('is read as far as the grant when its audience is the issuer', async () => {
    expect(await present([ISSUER])).toEqual({
      outcome: { kind: 'invalid_token', clientId: 'app' },
      grantLoaded: true,
    });
  });

  it.each([
    ['alone', [meAudienceOfIssuer(ISSUER)]],
    ['beside the issuer', [ISSUER, meAudienceOfIssuer(ISSUER)]],
  ])('is refused before any grant is read when it names the "me" audience %s', async (_l, aud) => {
    const { outcome, grantLoaded } = await present(aud);
    expect(outcome).toMatchObject({ kind: 'invalid_token' });
    expect(grantLoaded).toBe(false);
  });
});
