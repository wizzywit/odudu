import { provisionTenant } from '@odudu/authn-flows';
import { generateSigningKey, signingKeys, signJwt, type SigningKeyRecord } from '@odudu/crypto';
import { tenants, withTenant, type DatabaseHandle, type TenantScopedDatabase } from '@odudu/db';
import { hashPassword, subjectRepository, users } from '@odudu/domain-identity';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { CIBA_GRANT } from '#/service/ciba';
import { buildClientSigningKey, jwksDocumentFor } from '#/testing/private-key-jwt-fixture';

export const CIBA_KEK = Buffer.alloc(32, 13);

export interface CibaClient {
  readonly dbId: string;
  readonly clientId: string;
  readonly secret: string;
}

export interface CibaWorld {
  readonly tenantId: string;
  readonly tenant: string;
  readonly alice: { readonly subjectId: string; readonly username: string; readonly email: string };
  readonly bob: { readonly subjectId: string; readonly username: string };
  // Holds the CIBA grant.
  readonly agent: CibaClient;
  // Holds it too, to be a second client that is not the one that asked.
  readonly other: CibaClient;
  // Registered for the authorization code grant alone.
  readonly plain: CibaClient;
  // A public client that holds the grant, which the database allows and the
  // endpoints refuse.
  readonly pub: CibaClient;
  // Registered over the wire without an administrator, yet holding the grant,
  // which a row written by hand can; the endpoints refuse it.
  readonly wire: CibaClient;
  // Authenticates with a signed assertion.
  readonly assertion: CibaClient & { readonly key: SigningKeyRecord };
  readonly key: SigningKeyRecord;
}

async function addClient(
  tx: TenantScopedDatabase,
  tenantId: string,
  clientId: string,
  grantTypes: string[],
  kind: 'secret' | 'public' | { jwks: unknown } = 'secret',
  registrationOrigin: 'seeded' | 'anonymous' | 'cimd' = 'seeded',
): Promise<CibaClient> {
  const dbId = newId();
  const secret = `${clientId}-secret`;
  await tx.insert(clients).values({
    id: dbId,
    tenantId,
    clientId,
    name: `Client ${clientId}`,
    type: kind === 'public' ? 'public' : 'confidential',
    secretHash: kind === 'secret' ? await hashPassword(secret) : null,
    registrationOrigin,
  });
  await provisionClientDefaults(tx, dbId);
  await clientOidcConfigRepository(tx).create({
    clientId: dbId,
    tenantId,
    redirectUris: ['https://app.example/callback'],
    grantTypes,
    tokenEndpointAuthMethod:
      kind === 'secret' ? 'client_secret_basic' : kind === 'public' ? 'none' : 'private_key_jwt',
    ...(typeof kind === 'object' ? { jwks: kind.jwks } : {}),
    audiences: [],
    accessTokenTtlSeconds: 300,
    refreshTokenTtlSeconds: 1_209_600,
  });
  return { dbId, clientId, secret };
}

export async function seedCibaWorld(app: DatabaseHandle, label: string): Promise<CibaWorld> {
  const tenantId = newId();
  const tenant = `ciba-${label}-${tenantId.slice(-8)}`;
  return withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: tenant });
    await provisionTenant(tx, tenantId);

    const aliceSubject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({
      subjectId: aliceSubject.id,
      tenantId,
      username: 'alice',
      email: 'alice@example.test',
      emailVerified: true,
    });
    const bobSubject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({ subjectId: bobSubject.id, tenantId, username: 'bob' });

    const generated = await generateSigningKey('ES256', CIBA_KEK);
    const key: SigningKeyRecord = {
      id: newId(),
      tenantId,
      kid: generated.kid,
      alg: generated.alg,
      status: 'active',
      publicJwk: generated.publicJwk,
      privateJwkEncrypted: generated.privateJwkEncrypted,
      createdAt: new Date(),
      notAfter: null,
    };
    await tx.insert(signingKeys).values({
      id: key.id,
      tenantId,
      kid: key.kid,
      alg: key.alg,
      status: 'active',
      publicJwk: key.publicJwk,
      privateJwkEncrypted: key.privateJwkEncrypted,
    });

    const assertionKey = await buildClientSigningKey(CIBA_KEK, tenantId, 'ES256');
    const assertion = await addClient(tx, tenantId, 'assertion-agent', [CIBA_GRANT], {
      jwks: jwksDocumentFor(assertionKey),
    });

    return {
      tenantId,
      tenant,
      alice: { subjectId: aliceSubject.id, username: 'alice', email: 'alice@example.test' },
      bob: { subjectId: bobSubject.id, username: 'bob' },
      agent: await addClient(tx, tenantId, 'agent', [CIBA_GRANT]),
      other: await addClient(tx, tenantId, 'other-agent', [CIBA_GRANT]),
      plain: await addClient(tx, tenantId, 'plain', ['authorization_code']),
      pub: await addClient(tx, tenantId, 'public-agent', [CIBA_GRANT], 'public'),
      wire: await addClient(tx, tenantId, 'wire-agent', [CIBA_GRANT], 'secret', 'anonymous'),
      assertion: { ...assertion, key: assertionKey },
      key,
    };
  });
}

// An ID Token for `sub`, as this tenant's key would sign one for `audience`.
export function signHint(
  world: CibaWorld,
  issuer: string,
  audience: string,
  sub: string,
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  return signJwt(
    { iss: issuer, aud: audience, sub, iat, exp: iat + 300 },
    { key: world.key, kek: CIBA_KEK },
  );
}
