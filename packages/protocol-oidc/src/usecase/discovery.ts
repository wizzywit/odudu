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
  // This realm's active signing key's own algorithm, `null` for a realm
  // provisioned before a key was ever generated for it.
  activeSigningKeyAlg(realmId: string): Promise<string | null>;
  // What `userinfo_encrypted_response_alg`/`_enc` a client may register —
  // unlike signing, this never varies per realm (no server key is
  // involved, only the installed jose's own capability), so the caller
  // passes the same narrowed set every time rather than this package
  // reading it from a realm: `@odudu/crypto`'s `JWE_ALGS_PERMITTED` and
  // `service/client-metadata.ts`'s `USERINFO_ENCRYPTION_ENCS_PERMITTED`.
  userinfoEncryptionAlgSupported: readonly string[];
  userinfoEncryptionEncSupported: readonly string[];
  // Whether this deployment's `ODUDU_TRUST_PROXY` is on — server config,
  // not realm data, so it is read once per process the way `/token`'s own
  // `trustProxy` dep is, not resolved per realm. Gates
  // `token_endpoint_auth_methods_supported`'s `tls_client_auth` entry: see
  // `discoveryDocument`'s `tlsClientAuthEnabled`.
  trustProxy: boolean;
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
  const activeAlg = await deps.activeSigningKeyAlg(realm.id);
  return discoveryDocument({
    issuer: realmIssuer(issuerBase, realmName),
    claimsSupported: deps.claimNames(),
    scopesSupported,
    // `none` always belongs: it needs no key (OIDC Discovery §3).
    userinfoSigningAlgSupported: activeAlg === null ? ['none'] : [activeAlg, 'none'],
    userinfoEncryptionAlgSupported: deps.userinfoEncryptionAlgSupported,
    userinfoEncryptionEncSupported: deps.userinfoEncryptionEncSupported,
    clientRegistrationEnabled: realm.clientRegistrationPolicy !== 'disabled',
    tlsClientAuthEnabled: deps.trustProxy,
  });
}
