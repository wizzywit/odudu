import * as oauth from 'oauth4webapi';
import { fromServerError, OduduError } from '#/services/odudu-error';

// What a token endpoint request that did not succeed means for the caller.
export function tokenFailure(cause: unknown, refusal: string): OduduError {
  if (cause instanceof oauth.ResponseBodyError) {
    return fromServerError(cause.error, cause.error_description, refusal);
  }
  if (cause instanceof oauth.OperationProcessingError) {
    return new OduduError('invalid_id_token', `the response was refused: ${cause.message}`, {
      cause,
    });
  }
  return new OduduError('request_failed', 'the token request did not complete', { cause });
}
