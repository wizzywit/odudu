import { generateSigningKey, signJwt, type SigningKeyRecord } from '@odudu/crypto';
import { ADMIN_API_AUDIENCE } from '@odudu/domain-tenant';
import { type TenantLookup } from '@odudu/protocol-oidc';
import { describe, expect, it } from 'vitest';
import { authenticateAdmin, type AuthenticateAdminDeps } from '#/usecase/authenticate-admin';

const BASE = 'http://localhost:3000';
const KEK = Buffer.alloc(32, 3);
const FOREIGN: TenantLookup = {
  id: 'foreign-tenant-id',
  enabled: true,
  verifyEmail: false,
  ssoSessionMaxSeconds: 3600,
  ssoSessionIdleSeconds: 1800,
  rememberMeIdleSeconds: 3600,
  rememberMeMaxSeconds: 7200,
  rememberMeAllowed: false,
  maxSessionsPerBrowser: 5,
  clientRegistrationPolicy: 'disabled',
};

async function foreignKey(): Promise<SigningKeyRecord> {
  const generated = await generateSigningKey('ES256', KEK);
  return {
    id: 'key-id',
    tenantId: FOREIGN.id,
    status: 'active',
    createdAt: new Date(0),
    notAfter: null,
    ...generated,
  };
}

async function foreignToken(key: SigningKeyRecord): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: `${BASE}/tenants/foreign`,
      sub: 'subject-id',
      aud: [ADMIN_API_AUDIENCE],
      iat,
      exp: iat + 300,
      grant_id: 'grant-id',
    },
    { key, kek: KEK, typ: 'at+jwt' },
  );
}

function deps(key: SigningKeyRecord, overrides: Partial<AuthenticateAdminDeps>) {
  const base: AuthenticateAdminDeps = {
    findTenant: (name) => Promise.resolve(name === 'foreign' ? FOREIGN : null),
    listPublishableKeys: () => Promise.resolve([key]),
    loadGrant: () => Promise.resolve(null),
    isSessionLive: () => Promise.resolve(false),
    isClientEnabled: () => Promise.resolve(false),
  };
  return { ...base, ...overrides };
}

function authenticate(d: AuthenticateAdminDeps, token: string) {
  return authenticateAdmin(d, {
    authorizationHeader: `Bearer ${token}`,
    targetTenantName: 'target',
    targetTenantIssuer: `${BASE}/tenants/target`,
    systemTenantIssuer: `${BASE}/tenants/system`,
    issuerBase: BASE,
    now: new Date(),
  });
}

describe('a foreign issuer whose resolution fails', () => {
  const failure = new Error('database unavailable');

  it.each([
    ['findTenant', { findTenant: () => Promise.reject(failure) }],
    ['listPublishableKeys', { listPublishableKeys: () => Promise.reject(failure) }],
    ['loadGrant', { loadGrant: () => Promise.reject(failure) }],
  ] as const)('is the plain issuer mismatch when %s rejects, carrying the error', async (_, o) => {
    const key = await foreignKey();
    const outcome = await authenticate(deps(key, o), await foreignToken(key));

    expect(outcome).toEqual({
      kind: 'unauthenticated',
      reason: 'issuer_mismatch',
      foreignIssuerError: failure,
    });
  });

  it('still resolves the foreign issuer when nothing fails', async () => {
    const key = await foreignKey();
    const outcome = await authenticate(deps(key, {}), await foreignToken(key));

    expect(outcome).toEqual({
      kind: 'unauthenticated',
      reason: 'issuer_mismatch',
      foreignIssuer: { issuerTenantId: FOREIGN.id, subjectId: 'subject-id', clientDbId: null },
    });
  });
});
