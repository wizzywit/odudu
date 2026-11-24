import { type TokenErrorCode } from '#/service/oauth-errors';
import { type AuditAction, type AuditReason } from '@odudu/domain-audit';

export interface TokenRefusalAudit {
  readonly action:
    | Extract<AuditAction<'authentication'>, `client.${string}`>
    | Exclude<AuditAction<'token'>, `grant.${string}`>
    | Extract<AuditAction<'agent_identity'>, 'ciba.requested' | 'ciba.poll_refused'>;
  readonly reason: AuditReason;
  readonly clientDbId: string;
  readonly subjectId?: string;
  readonly grantId?: string;
  readonly approvalId?: string;
  readonly method?: string;
}

export type { TokenErrorCode } from '#/service/oauth-errors';

// The one shape every /token failure reports through. `invalidGrant()` in
// particular is called from every distinct way an authorization_code
// redemption can fail — unknown code, expired, replayed, wrong client,
// wrong redirect_uri, PKCE mismatch — so the response can never tell an
// attacker which check they failed (RFC 6749 §5.2).
export class TokenError extends Error {
  readonly error: TokenErrorCode;
  readonly status: number;
  readonly wwwAuthenticate: string | undefined;
  // Set only where ADR 0037 says a refusal is recorded; never read by the
  // response, which is identical with or without it.
  readonly audit: TokenRefusalAudit | undefined;
  // A sentence of its own where the code's fixed one would say the wrong thing.
  readonly description: string | undefined;

  constructor(
    error: TokenErrorCode,
    status: number,
    wwwAuthenticate?: string,
    audit?: TokenRefusalAudit,
    description?: string,
  ) {
    super(error);
    this.name = 'TokenError';
    this.error = error;
    this.status = status;
    this.wwwAuthenticate = wwwAuthenticate;
    this.audit = audit;
    this.description = description;
  }
}

export function withAudit(err: TokenError, audit: TokenRefusalAudit): TokenError {
  return new TokenError(err.error, err.status, err.wwwAuthenticate, audit, err.description);
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

// OpenID CIBA §11 and §13. Each answers 400 (§13's 403 for `access_denied` at
// the backchannel authentication endpoint is `refusedByServer` below).
export function authorizationPending(): TokenError {
  return new TokenError('authorization_pending', 400);
}

export function slowDown(audit?: TokenRefusalAudit): TokenError {
  return new TokenError('slow_down', 400, undefined, audit);
}

export function expiredToken(audit?: TokenRefusalAudit): TokenError {
  return new TokenError('expired_token', 400, undefined, audit);
}

export function accessDenied(audit?: TokenRefusalAudit): TokenError {
  return new TokenError('access_denied', 400, undefined, audit);
}

// §13: the server declines to create a request.
export function refusedByServer(audit: TokenRefusalAudit, description: string): TokenError {
  return new TokenError('access_denied', 403, undefined, audit, description);
}

export function invalidBindingMessage(): TokenError {
  return new TokenError('invalid_binding_message', 400);
}

// RFC 8707 §2: a `resource` named at /token that the redeemed code (or, on
// a refresh, the grant) did not carry — including a client asking for one
// at all when the stored value is empty. The same code the parameter's own
// error registration names, so a client narrowing at /token and one naming
// an unregistered audience at /authorize see the same failure mode.
export function invalidTarget(): TokenError {
  return new TokenError('invalid_target', 400);
}

// ADR 0023's client half: a client_secret_basic/client_secret_post attempt
// past its per-client budget. Not a TokenError — the refusal carries no
// `error` body, the way the per-origin throttle's 429 carries none, so a
// caller cannot use response shape to tell this apart from an
// authentication failure by anything but status and Retry-After.
export class TokenRateLimited extends Error {
  readonly retryAfterSeconds: number;
  readonly audit: TokenRefusalAudit | undefined;

  constructor(retryAfterSeconds: number, audit?: TokenRefusalAudit) {
    super('client_secret_rate_limited');
    this.name = 'TokenRateLimited';
    this.retryAfterSeconds = retryAfterSeconds;
    this.audit = audit;
  }
}
