export type TokenErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unsupported_grant_type'
  | 'invalid_scope';

// The one shape every /token failure reports through. `invalidGrant()` in
// particular is called from every distinct way an authorization_code
// redemption can fail — unknown code, expired, replayed, wrong client,
// wrong redirect_uri, PKCE mismatch — so the response can never tell an
// attacker which check they failed (RFC 6749 §5.2).
export class TokenError extends Error {
  readonly error: TokenErrorCode;
  readonly status: number;
  readonly wwwAuthenticate: string | undefined;

  constructor(error: TokenErrorCode, status: number, wwwAuthenticate?: string) {
    super(error);
    this.name = 'TokenError';
    this.error = error;
    this.status = status;
    this.wwwAuthenticate = wwwAuthenticate;
  }
}

export function invalidGrant(): TokenError {
  return new TokenError('invalid_grant', 400);
}

export function invalidClient(wwwAuthenticate: string): TokenError {
  return new TokenError('invalid_client', 401, wwwAuthenticate);
}

export function invalidRequest(): TokenError {
  return new TokenError('invalid_request', 400);
}

export function unsupportedGrantType(): TokenError {
  return new TokenError('unsupported_grant_type', 400);
}

export function invalidScope(): TokenError {
  return new TokenError('invalid_scope', 400);
}
