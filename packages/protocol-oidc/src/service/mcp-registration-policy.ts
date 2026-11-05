import { isLoopbackHost } from '#/service/client-metadata';
import { MCP_READ_SCOPE } from '#/service/mcp-scopes';

// What a client registered under the `mcp` policy may name for itself:
// the sign-in scopes and the read scope, never the write scope.
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
}

export type McpRegistrationDecision =
  | { kind: 'ok'; audiences: string[] }
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

function scopeRefusal(scope: unknown): string | null {
  if (scope === undefined) return null;
  if (typeof scope !== 'string') return 'scope must be a space-separated string';
  const outside = scope
    .split(/\s+/u)
    .find((token) => token !== '' && !REGISTRATION_SCOPES.has(token));
  return outside === undefined
    ? null
    : `scope ${outside} is not available under this tenant's registration policy`;
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
  const badRedirect = input.redirectUris.find((uri) => !isHttpsOrLoopbackHttp(uri));
  if (badRedirect !== undefined) {
    return refuse(
      'invalid_redirect_uri',
      `redirect_uris entry ${badRedirect} must be https, or http on a loopback host`,
    );
  }
  const problem = scopeRefusal(input.scope) ?? audienceRefusal(input.audience, input.mcpAudience);
  if (problem !== null) return refuse('invalid_client_metadata', problem);
  return { kind: 'ok', audiences: [input.mcpAudience] };
}

// What a dynamically resolved client's audience list becomes when the tenant's
// policy is applied to it: the MCP URL alone under `mcp`, and anything else
// left as it was with that URL taken out.
export function audiencesUnderPolicy(
  current: readonly string[],
  mcpAudience: string,
  policyIsMcp: boolean,
): string[] {
  return policyIsMcp ? [mcpAudience] : current.filter((audience) => audience !== mcpAudience);
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
