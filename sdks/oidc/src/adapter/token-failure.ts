import * as oauth from 'oauth4webapi';
import { fromServerError, OduduError } from '#/services/odudu-error';

const BODY_LIMIT = 8192;

// A server that refuses the client's authentication answers 401 with a
// challenge and, as RFC 6749 section 5.2 asks, an OAuth error body. The
// library raises the challenge before it reads the body, so the body is read
// here. A challenge with no readable OAuth error is not echoed.
async function challengeRefusal(
  cause: oauth.WWWAuthenticateChallengeError,
  refusal: string,
): Promise<OduduError | undefined> {
  const text = await cause.response
    .clone()
    .text()
    .catch(() => '');
  if (text.length > BODY_LIMIT) return undefined;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
  if (typeof body.error !== 'string') return undefined;
  const description = 'error_description' in body ? body.error_description : undefined;
  return fromServerError(
    body.error,
    typeof description === 'string' ? description : undefined,
    refusal,
  );
}

// What a token endpoint request that did not succeed means for the caller.
export async function tokenFailure(cause: unknown, refusal: string): Promise<OduduError> {
  if (cause instanceof oauth.ResponseBodyError) {
    return fromServerError(cause.error, cause.error_description, refusal);
  }
  if (cause instanceof oauth.WWWAuthenticateChallengeError) {
    const named = await challengeRefusal(cause, refusal);
    if (named !== undefined) return named;
  }
  if (cause instanceof oauth.OperationProcessingError) {
    return new OduduError('invalid_id_token', `the response was refused: ${cause.message}`, {
      cause,
    });
  }
  return new OduduError('request_failed', 'the token request did not complete', { cause });
}
