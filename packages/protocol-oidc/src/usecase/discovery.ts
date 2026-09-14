import { discoveryDocument, type DiscoveryDocument } from '@odudu/contracts';
import { type RealmLookup } from '#/repository/realm-lookup';
import { realmIssuer } from '#/service/issuer';

export interface DiscoveryUsecaseDeps {
  findRealm(name: string): Promise<RealmLookup | null>;
  // The claim mapper registry's own `claimNames()`, not a parallel literal —
  // so `claims_supported` can never advertise a claim `/userinfo` and ID
  // token issuance don't actually produce, or omit one they do.
  claimNames(): readonly string[];
  // The scope vocabulary the realm itself defines, so `scopes_supported` is
  // realm data rather than a constant in the binary. `/authorize` validates
  // against this same read.
  scopesForRealm(realmId: string): Promise<readonly string[]>;
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
  // Sorted, because the rows come back in whatever order the table hands
  // them over and a document that reshuffles between two identical requests
  // is one no client can cache or diff.
  const scopesSupported = [...(await deps.scopesForRealm(realm.id))].sort();
  return discoveryDocument({
    issuer: realmIssuer(issuerBase, realmName),
    claimsSupported: deps.claimNames(),
    scopesSupported,
  });
}
