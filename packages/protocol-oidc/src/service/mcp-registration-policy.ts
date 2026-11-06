import { isLoopbackHost } from '#/service/client-metadata';
import { MCP_RESOURCE_PATH } from '@odudu/kernel';
import { needsApproval } from '#/service/consent';
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from '#/service/mcp-scopes';

// What a client registered under the `mcp` policy may hold: the sign-in
// scopes and the read scope, never the write scope. A request for more is
// registered as the part that is held (RFC 7591 §3.2.1), because a client
// takes its scope from the metadata and asks for every scope listed there.
const REGISTRATION_SCOPES: ReadonlySet<string> = new Set([
  'openid',
  'profile',
  'email',
  'offline_access',
  MCP_READ_SCOPE,
]);

const REGISTRATION_GRANTS: ReadonlySet<string> = new Set(['authorization_code', 'refresh_token']);

export interface McpRegistrationInput {
  readonly redirectUris: readonly string[];
  readonly grantTypes: readonly string[];
  readonly tokenEndpointAuthMethod: string;
  // The registration body's `scope` and `audience` members, unparsed.
  readonly scope: unknown;
  readonly audience: unknown;
  readonly mcpAudience: string;
  // A public client holds no key, and a logout address would have this server
  // call or load an address its anonymous registrant chose.
  readonly holdsKeys: boolean;
  readonly hasLogoutUri: boolean;
}

export type McpRegistrationDecision =
  // `scope` is what was registered, present when one was asked for.
  | { kind: 'ok'; audiences: string[]; scope?: string }
  | {
      kind: 'invalid';
      error: 'invalid_redirect_uri' | 'invalid_client_metadata';
      description: string;
    };

function refuse(
  error: 'invalid_redirect_uri' | 'invalid_client_metadata',
  description: string,
): McpRegistrationDecision {
  return { kind: 'invalid', error, description };
}

function isHttpsOrLoopbackHttp(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname));
  } catch {
    return false;
  }
}

function audienceRefusal(audience: unknown, mcpAudience: string): string | null {
  if (audience === undefined) return null;
  const listed = Array.isArray(audience) ? audience : [audience];
  return listed.length === 1 && listed[0] === mcpAudience
    ? null
    : `audience must be ${mcpAudience} and nothing else under this tenant's registration policy`;
}

type ScopeDecision = { kind: 'ok'; scope?: string } | { kind: 'refused'; description: string };

function registrableScope(scope: unknown): ScopeDecision {
  if (scope === undefined) return { kind: 'ok' };
  if (typeof scope !== 'string') {
    return { kind: 'refused', description: 'scope must be a space-separated string' };
  }
  const asked = scope.split(/\s+/u).filter((token) => token !== '');
  const held = [...new Set(asked.filter((token) => REGISTRATION_SCOPES.has(token)))];
  if (held.length === 0 && asked.length > 0) {
    return {
      kind: 'refused',
      description: `scope ${asked[0] ?? ''} is not available under this tenant's registration policy`,
    };
  }
  return { kind: 'ok', scope: held.join(' ') };
}

// The `mcp` registration policy: open to a public client that can only reach
// the tenant's MCP endpoint, and to nothing wider. The audience it returns
// is the whole of what the new client may be issued a token for.
export function decideMcpRegistration(input: McpRegistrationInput): McpRegistrationDecision {
  if (input.tokenEndpointAuthMethod !== 'none') {
    return refuse(
      'invalid_client_metadata',
      "token_endpoint_auth_method must be none: this tenant's registration policy admits public clients only",
    );
  }
  const badGrant = input.grantTypes.find((grant) => !REGISTRATION_GRANTS.has(grant));
  if (badGrant !== undefined) {
    return refuse('invalid_client_metadata', `grant_types must not include ${badGrant}`);
  }
  if (input.holdsKeys) {
    return refuse(
      'invalid_client_metadata',
      'jwks and jwks_uri are not accepted: a public client holds no key',
    );
  }
  if (input.hasLogoutUri) {
    return refuse(
      'invalid_client_metadata',
      "logout addresses are not accepted under this tenant's registration policy",
    );
  }
  const badRedirect = input.redirectUris.find((uri) => !isHttpsOrLoopbackHttp(uri));
  if (badRedirect !== undefined) {
    return refuse(
      'invalid_redirect_uri',
      `redirect_uris entry ${badRedirect} must be https, or http on a loopback host`,
    );
  }
  const scope = registrableScope(input.scope);
  if (scope.kind === 'refused') return refuse('invalid_client_metadata', scope.description);
  const problem = audienceRefusal(input.audience, input.mcpAudience);
  if (problem !== null) return refuse('invalid_client_metadata', problem);
  return {
    kind: 'ok',
    audiences: [input.mcpAudience],
    ...(scope.scope === undefined ? {} : { scope: scope.scope }),
  };
}

// What a dynamically resolved client's audience list becomes when the tenant's
// policy is applied to it: the MCP URL alone under `mcp`, and anything else
// left as it was with that URL taken out.
export function audiencesUnderPolicy(
  current: readonly string[],
  mcpAudience: string,
  policyIsMcp: boolean,
): string[] {
  return policyIsMcp ? [mcpAudience] : current.filter((audience) => !isMcpUrl(audience));
}

// An audience the policy itself gave: a tenant's MCP endpoint is its address
// followed by `/mcp`, and a tenant that has changed address holds the same
// path under each address it had, so the path is what marks one.
function isMcpUrl(audience: string): boolean {
  try {
    return new URL(audience).pathname.endsWith(MCP_RESOURCE_PATH);
  } catch {
    return false;
  }
}

// What the tenant's policy says about a client resolved from a metadata
// document: the MCP URL, and whether the policy grants it. The URL is carried
// even when it is not granted, so a client that held it can have it taken off.
export interface McpPolicyGrant {
  readonly audience: string;
  readonly granted: boolean;
}

export function mcpGrantOf(policy: string, mcpAudience: string): McpPolicyGrant {
  return { audience: mcpAudience, granted: policy === 'mcp' };
}

// For a caller with no tenant policy to apply: nothing is granted, and no
// audience is taken away.
export const NO_MCP_GRANT: McpPolicyGrant = { audience: '', granted: false };

// What a client registered over the wire, or resolved from a document, is
// asked about: the request without the write scope it can never be given
// (RFC 6749 §3.3). A request for the write scope alone is returned whole, so
// that `refusesWriteScope` still refuses it: nothing grantable is left.
export function grantableScopes(
  registrationOrigin: string,
  requestedScopes: readonly string[],
): string[] {
  if (!needsApproval(registrationOrigin)) return [...requestedScopes];
  const kept = requestedScopes.filter((scope) => scope !== MCP_WRITE_SCOPE);
  return kept.length === 0 ? [...requestedScopes] : kept;
}

export function requestWithGrantableScope<T extends { readonly scope?: string | undefined }>(
  registrationOrigin: string,
  params: T,
): T {
  if (params.scope === undefined) return params;
  const asked = params.scope.split(' ').filter((token) => token !== '');
  const grantable = grantableScopes(registrationOrigin, asked);
  return grantable.length === asked.length ? params : { ...params, scope: grantable.join(' ') };
}

// A client registered over the wire, or resolved from a document, is never
// given the write scope, whatever an administrator assigned it.
export function refusesWriteScope(
  registrationOrigin: string,
  requestedScopes: readonly string[],
): boolean {
  return needsApproval(registrationOrigin) && requestedScopes.includes(MCP_WRITE_SCOPE);
}

// The audiences a client may be issued a token for under the tenant's policy
// as it is now. A client registered over the wire or resolved from a document
// holds an MCP URL only while the policy is `mcp`, and then the tenant's
// current one, whichever address its row or grant was written under.
export function audiencesHeld(
  registrationOrigin: string,
  policy: string,
  audiences: readonly string[],
  mcpAudience: string,
): string[] {
  if (!needsApproval(registrationOrigin)) return [...audiences];
  const others = audiences.filter((audience) => !isMcpUrl(audience));
  const heldOne = others.length < audiences.length;
  return policy === 'mcp' && heldOne ? [...others, mcpAudience] : others;
}

// What a refresh may carry, re-derived from the policy as it stands: the MCP
// audience and mcp:read go once the tenant stops granting them.
export function refreshUnderPolicy(input: {
  readonly registrationOrigin: string;
  readonly policy: string;
  readonly mcpAudience: string;
  readonly scope: readonly string[];
  readonly audience: readonly string[];
}): { scope: string[]; audience: string[] } {
  const audience = audiencesHeld(
    input.registrationOrigin,
    input.policy,
    input.audience,
    input.mcpAudience,
  );
  if (!needsApproval(input.registrationOrigin) || input.policy === 'mcp') {
    return { scope: [...input.scope], audience };
  }
  return { scope: input.scope.filter((scope) => scope !== MCP_READ_SCOPE), audience };
}

// A metadata document client takes part in the `mcp` policy only as a public
// client, as a registered one does.
export function grantForClient(policy: McpPolicyGrant, publicClient: boolean): McpPolicyGrant {
  return publicClient ? policy : { ...policy, granted: false };
}
