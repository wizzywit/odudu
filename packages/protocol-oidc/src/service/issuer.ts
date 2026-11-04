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
