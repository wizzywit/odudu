import { KeyFetchError, VerificationError } from '#/services/verification-error';

// What an adapter writes when a request is not let through.
export interface Refusal {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const refusal = (
  status: number,
  error: string,
  description: string,
  extra: Record<string, string>,
): Refusal => ({
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  body: JSON.stringify({ error, error_description: description }),
});

// RFC 6750 §3.1: no error code when the request carried no credentials.
export const noCredentials = (): Refusal =>
  refusal(401, 'unauthorized', 'An access token is required', { 'www-authenticate': 'Bearer' });

export const badRequest = (): Refusal =>
  refusal(400, 'invalid_request', 'The Authorization header is malformed', {
    'www-authenticate': 'Bearer error="invalid_request"',
  });

// The API is well; it cannot check tokens until the issuer's keys can be read.
export const keysUnavailable = (): Refusal =>
  refusal(503, 'temporarily_unavailable', 'Access tokens cannot be checked right now', {
    'retry-after': '10',
  });

export const serverError = (): Refusal =>
  refusal(500, 'server_error', 'The request could not be handled', {});

// The refusal for an error the verifier raised, or undefined for any other
// error, which is not this package's to answer.
export function refusalFor(error: unknown): Refusal | undefined {
  if (error instanceof VerificationError) {
    return refusal(error.status, error.code, error.message, {
      'www-authenticate': error.challenge,
    });
  }
  if (error instanceof KeyFetchError) return keysUnavailable();
  return undefined;
}
