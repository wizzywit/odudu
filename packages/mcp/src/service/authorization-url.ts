import { StdioError } from '#/service/stdio-error';

export interface AuthorizationRequest {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scope: string;
  readonly state: string;
  readonly challenge: string;
  // RFC 8707: the audience the token is for.
  readonly resource: string;
}

// RFC 6749 section 3.1: a query the endpoint carries is kept. One that names a
// parameter this request sets is refused, since either value would be dropped.
export function authorizationUrl(endpoint: string, request: AuthorizationRequest): string {
  const url = new URL(endpoint);
  const added = new URLSearchParams({
    response_type: 'code',
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    scope: request.scope,
    state: request.state,
    code_challenge: request.challenge,
    code_challenge_method: 'S256',
    resource: request.resource,
  });
  for (const [name, value] of added) {
    if (url.searchParams.has(name)) {
      throw new StdioError(
        'mcp_discovery_invalid',
        `the authorization endpoint's own query sets ${name}, which this client sets itself`,
      );
    }
    url.searchParams.append(name, value);
  }
  return url.href;
}
