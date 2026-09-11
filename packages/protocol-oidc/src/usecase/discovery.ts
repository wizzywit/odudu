import { discoveryDocument, type DiscoveryDocument } from '@odudu/contracts';
import { type RealmLookup } from '#/repository/realm-lookup';

export interface DiscoveryUsecaseDeps {
  findRealm(name: string): Promise<RealmLookup | null>;
  // The claim mapper registry's own `claimNames()`, not a parallel literal —
  // so `claims_supported` can never advertise a claim `/userinfo` and ID
  // token issuance don't actually produce, or omit one they do.
  claimNames(): readonly string[];
}

// Returns null for both an unknown realm and a disabled one — the view
// layer turns either into 404, so a disabled realm never distinguishes
// itself from a nonexistent one via status code.
export async function resolveDiscoveryDocument(
  deps: DiscoveryUsecaseDeps,
  realmName: string,
  issuerBase: string,
): Promise<DiscoveryDocument | null> {
  const realm = await deps.findRealm(realmName);
  if (!realm?.enabled) return null;
  return discoveryDocument({
    issuer: `${issuerBase}/realms/${realmName}`,
    claimsSupported: deps.claimNames(),
  });
}
