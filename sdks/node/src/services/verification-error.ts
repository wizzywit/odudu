// The RFC 6750 §3.1 error codes a resource server answers with.
export type VerificationCode = 'invalid_token' | 'insufficient_scope';

// Which check refused the token. For logs and tests; it is never put in the
// challenge, so a caller learns no more than the code and a fixed description.
export type VerificationReason =
  | 'malformed'
  | 'invalid_header'
  | 'wrong_type'
  | 'unsupported_algorithm'
  | 'wrong_issuer'
  | 'unknown_key'
  | 'bad_signature'
  | 'expired'
  | 'not_yet_valid'
  | 'wrong_audience'
  | 'me_audience'
  | 'invalid_claims'
  | 'insufficient_scope';

const DESCRIPTION: Record<VerificationReason, string> = {
  malformed: 'The access token is invalid',
  invalid_header: 'The access token is invalid',
  wrong_type: 'The access token is invalid',
  unsupported_algorithm: 'The access token is invalid',
  wrong_issuer: 'The access token is invalid',
  unknown_key: 'The access token is invalid',
  bad_signature: 'The access token is invalid',
  expired: 'The access token expired',
  not_yet_valid: 'The access token is invalid',
  wrong_audience: 'The access token is invalid',
  me_audience: 'The access token is invalid',
  invalid_claims: 'The access token is invalid',
  insufficient_scope: 'The access token lacks the required scope',
};

// A quoted-string value of a challenge parameter (RFC 7230 §3.2.6).
const quoted = (value: string): string => `"${value.replace(/[\\"]/gu, '\\$&')}"`;

export class VerificationError extends Error {
  readonly status: 401 | 403;
  readonly code: VerificationCode;
  readonly reason: VerificationReason;
  // The `WWW-Authenticate` value to send with the response.
  readonly challenge: string;

  constructor(reason: VerificationReason, requiredScope?: string) {
    const code: VerificationCode = reason === 'insufficient_scope' ? reason : 'invalid_token';
    super(DESCRIPTION[reason]);
    this.name = 'VerificationError';
    this.status = reason === 'insufficient_scope' ? 403 : 401;
    this.code = code;
    this.reason = reason;
    const parts = [`error=${quoted(code)}`, `error_description=${quoted(DESCRIPTION[reason])}`];
    if (requiredScope !== undefined && reason === 'insufficient_scope') {
      parts.push(`scope=${quoted(requiredScope)}`);
    }
    this.challenge = `Bearer ${parts.join(', ')}`;
  }
}

// The issuer's keys could not be read. The token has not been judged: the API
// answers 503, not 401, so a client does not discard a token that is fine.
export class KeyFetchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'KeyFetchError';
  }
}
