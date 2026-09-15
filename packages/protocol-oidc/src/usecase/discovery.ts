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

// RP-Initiated Logout 1.0's own metadata extension to OIDC Discovery, not
// part of @odudu/contracts' DiscoveryDocument: that package is the
// protocol-agnostic core, and this member belongs to a specific extension
// document this package implements, the way client_oidc_config carries
// OAuth vocabulary domain-realm's ClientRecord does not (see its own
// comment for the same reasoning).
export interface OidcDiscoveryDocument extends DiscoveryDocument {
  readonly end_session_endpoint: string;
}

// Returns null for both an unknown realm and a disabled one — the view
// layer turns either into 404, so a disabled realm never distinguishes
// itself from a nonexistent one via status code.
export async function resolveDiscoveryDocument(
  deps: DiscoveryUsecaseDeps,
  realmName: string,
  issuerBase: string,
): Promise<OidcDiscoveryDocument | null> {
  const realm = await deps.findRealm(realmName);
  if (!realm?.enabled) return null;
  // Sorted, because the rows come back in whatever order the table hands
  // them over and a document that reshuffles between two identical requests
  // is one no client can cache or diff.
  const scopesSupported = [...(await deps.scopesForRealm(realm.id))].sort();
  const document = discoveryDocument({
    issuer: realmIssuer(issuerBase, realmName),
    claimsSupported: deps.claimNames(),
    scopesSupported,
  });
  return {
    ...document,
    end_session_endpoint: `${document.issuer}/protocol/openid-connect/logout`,
  };
}
