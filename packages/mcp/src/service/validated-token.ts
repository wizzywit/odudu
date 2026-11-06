declare const validated: unique symbol;

// What an MCP-audience access token proved at the MCP endpoint, once its
// signature, issuer, audience, type, expiry and scope have been checked. The
// tenant is the token's own, never a tool's input; everything the exchange
// needs to act for the owner is in it. Only `validatedMcpToken` makes one, so
// a value of this type has come through the endpoint's verification.
export interface ValidatedMcpToken {
  readonly [validated]: true;
  readonly tenant: { readonly id: string; readonly name: string };
  // The `iss` the token carries, which the admin API accepts for the tenant.
  readonly issuer: string;
  // The token's `sub`, which must be the owner of its grant.
  readonly subjectId: string;
  // The OAuth `client_id` of the agent the token was issued to.
  readonly clientId: string;
  readonly grantId: string;
  readonly scope: readonly string[];
  // The token's `exp`, as an instant.
  readonly expiresAt: Date;
}

// The claims of a token that has been verified, as the verifier read them.
export interface VerifiedMcpClaims {
  readonly tenant: { readonly id: string; readonly name: string };
  readonly issuer: string;
  readonly subjectId: string;
  readonly clientId: string;
  readonly grantId: string;
  readonly scope: readonly string[];
  // `exp` as the JWT carries it, in seconds since the epoch.
  readonly expSeconds: number;
}

export function validatedMcpToken(claims: VerifiedMcpClaims): ValidatedMcpToken {
  if (!Number.isSafeInteger(claims.expSeconds) || claims.expSeconds <= 0) {
    throw new RangeError('exp is a count of seconds since the epoch');
  }
  const token: Omit<ValidatedMcpToken, typeof validated> = {
    tenant: { id: claims.tenant.id, name: claims.tenant.name },
    issuer: claims.issuer,
    subjectId: claims.subjectId,
    clientId: claims.clientId,
    grantId: claims.grantId,
    scope: [...claims.scope],
    expiresAt: new Date(claims.expSeconds * 1000),
  };
  return token as ValidatedMcpToken;
}
