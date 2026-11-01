import { describe, expect, it } from 'vitest';
import { JWE_ALGS_PERMITTED } from '../../packages/crypto/src/index.js';
import { TENANT_DEFAULT_SCOPE_NAMES } from '../../packages/domain-tenant/src/usecase/provision-defaults.js';
import { standardClaimMappers } from '../../packages/protocol-oidc/src/service/claims.js';
import { USERINFO_ENCRYPTION_ENCS_PERMITTED } from '../../packages/protocol-oidc/src/service/client-metadata.js';
import { resolveDiscoveryDocument } from '../../packages/protocol-oidc/src/usecase/discovery.js';
import { jsonAfter, loadPages, PROTOCOL_PAGES } from './markdown.js';

// Both documents show the discovery response for this tenant on this stack, so
// the document under test fixes the issuer the comparison is made against.
const TENANT = 'demo';
const ISSUER_BASE = 'http://localhost:3000';
const CURL = `curl -sS ${ISSUER_BASE}/tenants/${TENANT}/.well-known/openid-configuration`;

async function serverDiscoveryDocument(): Promise<Record<string, unknown>> {
  const claimMappers = standardClaimMappers();
  const document = await resolveDiscoveryDocument(
    {
      findTenant: () =>
        Promise.resolve({
          id: '01a096f4-0000-0000-0000-000000000000',
          enabled: true,
          verifyEmail: false,
          ssoSessionMaxSeconds: 36_000,
          ssoSessionIdleSeconds: 1_800,
          rememberMeIdleSeconds: 604_800,
          rememberMeMaxSeconds: 2_592_000,
          rememberMeAllowed: false,
          loginWithEmail: false,
          passwordRules: {
            minLength: 15,
            requireDigit: false,
            requireUppercase: false,
            requireLowercase: false,
            requireSpecial: false,
          },
          registrationAllowed: false,
          resetPasswordAllowed: false,
          maxSessionsPerBrowser: 25,
          clientRegistrationPolicy: 'disabled',
          // What a tenant that never set them has: English only, no default.
          supportedLocales: ['en'],
          defaultLocale: null,
        }),
      claimNames: () => Promise.resolve(claimMappers.claimNames()),
      // What `seed tenant` puts in a tenant, so the document is checked against
      // the vocabulary a freshly seeded stack actually serves.
      scopesForTenant: () => Promise.resolve(TENANT_DEFAULT_SCOPE_NAMES),
      // `seed bootstrap` generates a tenant's first signing key as RS256
      // (apps/server/src/cli/seed.ts) — the same key a freshly seeded
      // stack's `/userinfo` would sign with.
      algorithmsAvailable: () => Promise.resolve(['RS256']),
      // Fixed by the installed jose, not by anything `seed` writes — the
      // same two call sites `usecase/discovery.ts`'s own reading note names.
      userinfoEncryptionAlgSupported: JWE_ALGS_PERMITTED,
      userinfoEncryptionEncSupported: USERINFO_ENCRYPTION_ENCS_PERMITTED,
      // ODUDU_TRUST_PROXY defaults false, and the protocol pages' own
      // transcript was captured against a stack that never set it — see
      // this same value's effect on token_endpoint_auth_methods_supported.
      trustProxy: false,
    },
    TENANT,
    ISSUER_BASE,
  );
  if (document === null) throw new Error('the discovery usecase returned no document');
  return { ...document };
}

describe('the discovery document the guide publishes is the one the server produces', () => {
  it('matches the protocol pages member for member', async () => {
    const shown = jsonAfter(loadPages(PROTOCOL_PAGES), CURL);

    expect(
      shown,
      'the protocol pages show a discovery response the server no longer produces',
    ).toEqual(await serverDiscoveryDocument());
  });
});
