// Codes an authorization server answers with (RFC 6749, RFC 8707, OIDC Core
// section 3.1.2.6).
const OAUTH_CODES = [
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'unsupported_response_type',
  'invalid_scope',
  'invalid_target',
  'access_denied',
  'server_error',
  'temporarily_unavailable',
  'login_required',
  'consent_required',
  'interaction_required',
  'account_selection_required',
] as const;

// Codes the core raises on its own account.
type LocalCode =
  | 'invalid_options'
  | 'audience_not_granted'
  | 'discovery_failed'
  | 'invalid_state'
  | 'invalid_issuer'
  | 'invalid_callback'
  | 'invalid_id_token'
  | 'request_failed'
  | 'unrecognized_error';

export type OduduErrorCode = (typeof OAUTH_CODES)[number] | LocalCode;

export interface OduduErrorDetail {
  // The server's own `error` and `error_description`, when it sent them.
  error?: string;
  errorDescription?: string;
  cause?: unknown;
}

export class OduduError extends Error {
  readonly code: OduduErrorCode;
  readonly error: string | undefined;
  readonly errorDescription: string | undefined;

  constructor(code: OduduErrorCode, message: string, detail: OduduErrorDetail = {}) {
    super(message, detail.cause === undefined ? undefined : { cause: detail.cause });
    this.name = 'OduduError';
    this.code = code;
    this.error = detail.error;
    this.errorDescription = detail.errorDescription;
  }
}

function isOauthCode(value: string): value is (typeof OAUTH_CODES)[number] {
  return (OAUTH_CODES as readonly string[]).includes(value);
}

// An error the server named, with the server's words kept and its code
// narrowed to the closed set.
export function fromServerError(
  error: string,
  errorDescription: string | undefined,
  message: string,
): OduduError {
  const code = isOauthCode(error) ? error : 'unrecognized_error';
  return new OduduError(code, message, {
    error,
    ...(errorDescription === undefined ? {} : { errorDescription }),
  });
}
