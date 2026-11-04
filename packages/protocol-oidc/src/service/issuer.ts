import { addressIssuer, pathAddress } from '@odudu/kernel';

// One tenant's issuer identifier, derived from the deployment's issuer base.
// OIDC Discovery §3 and §4.3 and RFC 9207 §2.3 require the discovery
// document's `issuer`, the `iss` claim in ID Tokens, the `iss`
// authorization-response parameter and the value `/userinfo` verifies an
// access token against to be the same string, byte for byte. That is a
// requirement about the whole identifier, not just its authority, so the
// path is appended by the address service rather than in each producer.
export function tenantIssuer(issuerBase: string, tenantName: string): string {
  return addressIssuer(pathAddress(issuerBase, tenantName));
}

export interface RetiredIssuerWindow {
  readonly issuer: string;
  readonly expiresAt: Date;
}

// The issuers a tenant still recognises on a token or a hint it signed: its
// canonical one, then each retired one whose window has not ended. A window
// ends at its `expiresAt`, which is already outside it.
export function acceptedIssuers(
  canonical: string,
  retired: readonly RetiredIssuerWindow[],
  now: Date,
): readonly string[] {
  const live = retired
    .filter((entry) => entry.expiresAt.getTime() > now.getTime())
    .map((entry) => entry.issuer);
  return [...new Set([canonical, ...live])];
}

// Resolves what a request's tenant accepts. `requestIssuer` stands in for the
// canonical issuer where no public base URL is configured, because a switch
// needs one and so nothing can have been retired.
export type AcceptedIssuersLookup = (
  tenant: { readonly id: string; readonly name: string },
  requestIssuer: string,
  now: Date,
) => Promise<readonly string[]>;
