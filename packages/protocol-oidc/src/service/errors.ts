export type TokenErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'unauthorized_client';

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

// RFC 6749 §5.2: the client is authenticated but not authorized to use this
// grant type. Used for a confidential client that has never been
// provisioned with a service subject — a configuration error caught at
// request time, distinct from `invalid_client` (which is about who the
// client is, not what it's allowed to do).
export function unauthorizedClient(): TokenError {
  return new TokenError('unauthorized_client', 400);
}

// ADR 0023's client half: a client_secret_basic/client_secret_post attempt
// past its per-client budget. Not a TokenError — the refusal carries no
// `error` body, the way the per-origin throttle's 429 carries none, so a
// caller cannot use response shape to tell this apart from an
// authentication failure by anything but status and Retry-After.
export class TokenRateLimited extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('client_secret_rate_limited');
    this.name = 'TokenRateLimited';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
