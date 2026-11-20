import { OduduError } from '@odudu-io/oidc';
import type { AuthState, Claims } from '#/types';

export const LOADING: AuthState = { status: 'loading', claims: undefined, error: undefined };

export function signedIn(claims: Claims): AuthState {
  return { status: 'signedIn', claims, error: undefined };
}

export function signedOut(error?: OduduError): AuthState {
  return { status: 'signedOut', claims: undefined, error };
}

// Anything that is not already an OduduError is a failure to reach a server.
export function asOduduError(error: unknown): OduduError {
  return error instanceof OduduError
    ? error
    : new OduduError('request_failed', 'the request could not be completed', { cause: error });
}

// The refresh token was refused: the session is over for good.
export function endsSession(error: unknown): boolean {
  return error instanceof OduduError && error.code === 'invalid_grant';
}

// A failure that leaves the person where they were, with its reason.
export function withError(state: AuthState, error: OduduError): AuthState {
  return { ...state, error };
}
