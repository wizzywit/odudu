import { authorizationValues, readCredentials } from '#/services/authorization';
import { badRequest, noCredentials, refusalFor, type Refusal } from '#/services/refusal';
import { VerificationError } from '#/services/verification-error';
import type { VerifiedToken, Verifier } from '#/types';

// The part of a Node request that holds the credentials.
export interface RequestHeaders {
  headers: { authorization?: string | string[] | undefined };
  rawHeaders?: readonly string[] | undefined;
}

export type Outcome = { auth: VerifiedToken } | { refusal: Refusal };

// Judges the credentials of one request. A refusal is the answer to send; an
// error that is neither the token's fault nor the keys' is thrown.
export async function authenticate(
  verifier: Verifier,
  request: RequestHeaders,
  scope: string | undefined,
): Promise<Outcome> {
  const credentials = readCredentials(
    authorizationValues(request.rawHeaders, request.headers.authorization),
  );
  if (credentials.kind === 'none') return { refusal: noCredentials() };
  if (credentials.kind === 'malformed') return { refusal: badRequest() };
  try {
    const auth = await verifier(credentials.token);
    if (scope !== undefined && !auth.scope.includes(scope)) {
      throw new VerificationError('insufficient_scope', scope);
    }
    return { auth };
  } catch (error) {
    const refusal = refusalFor(error);
    if (refusal === undefined) throw error;
    return { refusal };
  }
}
