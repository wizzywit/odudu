// What an MCP-audience access token proved at the MCP endpoint, once its
// signature, issuer, audience, type, expiry and scope have been checked. The
// tenant is the token's own, never a tool's input; everything the exchange
// needs to act for the owner is in it.
export interface ValidatedMcpToken {
  readonly tenant: { readonly id: string; readonly name: string };
  // The `iss` the token carries, which the admin API accepts for the tenant.
  readonly issuer: string;
  readonly subjectId: string;
  // The OAuth `client_id` of the agent the token was issued to.
  readonly clientId: string;
  readonly grantId: string;
  readonly scope: readonly string[];
  readonly expiresAt: Date;
}
