export interface AuthorizationRequest {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scope: string;
  readonly state: string;
  readonly challenge: string;
  // RFC 8707: the audience the token is for.
  readonly resource: string;
}

export function authorizationUrl(endpoint: string, request: AuthorizationRequest): string {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    scope: request.scope,
    state: request.state,
    code_challenge: request.challenge,
    code_challenge_method: 'S256',
    resource: request.resource,
  }).toString();
  return url.href;
}
