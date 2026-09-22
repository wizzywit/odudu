import { discoveryDocument, type DiscoveryDocument } from '@odudu/contracts';
import { type TenantLookup } from '#/repository/tenant-lookup';
import { tenantIssuer } from '#/service/issuer';

export interface DiscoveryUsecaseDeps {
  findTenant(name: string): Promise<TenantLookup | null>;
  // The claim mapper registry's own `claimNames()`, and the tenant's own
  // scope rows — never a parallel literal, so neither list can advertise
  // something `/userinfo`, ID token issuance or `/authorize` disagree with.
  claimNames(): readonly string[];
  scopesForTenant(tenantId: string): Promise<readonly string[]>;
  // `null` for a tenant provisioned before a key was generated for it.
  activeSigningKeyAlg(tenantId: string): Promise<string | null>;
  // Unlike signing, encryption involves no server key, so these never vary
  // per tenant: `@odudu/crypto`'s `JWE_ALGS_PERMITTED` and
  // `service/client-metadata.ts`'s `USERINFO_ENCRYPTION_ENCS_PERMITTED`.
  userinfoEncryptionAlgSupported: readonly string[];
  userinfoEncryptionEncSupported: readonly string[];
  // `ODUDU_TRUST_PROXY` is server config, not tenant data, so it is read once
  // per process rather than resolved per tenant.
  trustProxy: boolean;
}

// Null for both an unknown tenant and a disabled one: the view layer turns
// either into 404, so neither distinguishes itself from the other.
export async function resolveDiscoveryDocument(
  deps: DiscoveryUsecaseDeps,
  tenantName: string,
  issuerBase: string,
): Promise<DiscoveryDocument | null> {
  const tenant = await deps.findTenant(tenantName);
  if (!tenant?.enabled) return null;
  // Sorted: the rows arrive in whatever order the table hands over, and a
  // document that reshuffles between identical requests cannot be diffed.
  const scopesSupported = [...(await deps.scopesForTenant(tenant.id))].sort();
  const activeAlg = await deps.activeSigningKeyAlg(tenant.id);
  return discoveryDocument({
    issuer: tenantIssuer(issuerBase, tenantName),
    claimsSupported: deps.claimNames(),
    scopesSupported,
    // `none` always belongs: it needs no key (OIDC Discovery §3).
    userinfoSigningAlgSupported: activeAlg === null ? ['none'] : [activeAlg, 'none'],
    userinfoEncryptionAlgSupported: deps.userinfoEncryptionAlgSupported,
    userinfoEncryptionEncSupported: deps.userinfoEncryptionEncSupported,
    clientRegistrationEnabled: tenant.clientRegistrationPolicy !== 'disabled',
    tlsClientAuthEnabled: deps.trustProxy,
  });
}
