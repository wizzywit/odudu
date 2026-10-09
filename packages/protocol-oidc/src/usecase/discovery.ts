import { discoveryDocument, type DiscoveryDocument } from '@odudu/contracts';
import { type TenantLookup } from '#/repository/tenant-lookup';
import { tenantIssuer } from '#/service/issuer';

export interface DiscoveryUsecaseDeps {
  findTenant(name: string): Promise<TenantLookup | null>;
  // The claim mapper registry's own `claimNamesForScopes`, applied to this
  // tenant's own scope rows and binding overrides — never a parallel
  // literal, so neither list can advertise something `/userinfo`, ID token
  // issuance or `/authorize` disagree with. Per tenant, because a binding
  // narrows what one tenant's scopes reach without touching another's.
  claimNames(tenantId: string): Promise<readonly string[]>;
  scopesForTenant(tenantId: string): Promise<readonly string[]>;
  // Empty for a tenant provisioned before a key was generated for it.
  algorithmsAvailable(tenantId: string): Promise<readonly string[]>;
  // Unlike signing, encryption involves no server key, so these never vary
  // per tenant: `@odudu/crypto`'s `JWE_ALGS_PERMITTED` and
  // `service/client-metadata.ts`'s `USERINFO_ENCRYPTION_ENCS_PERMITTED`.
  userinfoEncryptionAlgSupported: readonly string[];
  userinfoEncryptionEncSupported: readonly string[];
  // `ODUDU_TRUST_PROXY` is server config, not tenant data, so it is read once
  // per process rather than resolved per tenant.
  trustProxy: boolean;
}

// Null for an unknown tenant, which the view layer turns into 404. A disabled
// tenant is still described, since it still publishes the keys its queued
// Logout Tokens are signed with; every other endpoint refuses it.
export async function resolveDiscoveryDocument(
  deps: DiscoveryUsecaseDeps,
  tenantName: string,
  issuerBase: string,
): Promise<DiscoveryDocument | null> {
  const tenant = await deps.findTenant(tenantName);
  if (tenant === null) return null;
  // Sorted: the rows arrive in whatever order the table hands over, and a
  // document that reshuffles between identical requests cannot be diffed.
  const scopesSupported = [...(await deps.scopesForTenant(tenant.id))].sort();
  const algs = [...(await deps.algorithmsAvailable(tenant.id))].sort();
  return discoveryDocument({
    issuer: tenantIssuer(issuerBase, tenantName),
    claimsSupported: await deps.claimNames(tenant.id),
    scopesSupported,
    // `none` always belongs: it needs no key (OIDC Discovery §3).
    userinfoSigningAlgSupported: [...algs, 'none'],
    userinfoEncryptionAlgSupported: deps.userinfoEncryptionAlgSupported,
    userinfoEncryptionEncSupported: deps.userinfoEncryptionEncSupported,
    clientRegistrationEnabled: tenant.enabled && tenant.clientRegistrationPolicy !== 'disabled',
    tlsClientAuthEnabled: deps.trustProxy,
  });
}
