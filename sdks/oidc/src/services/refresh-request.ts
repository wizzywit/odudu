import type { IDToken, TokenEndpointResponse } from 'oauth4webapi';
import { OduduError } from '#/services/odudu-error';
import { refreshExpiresAtOf } from '#/services/token-set';
import type { TokenSet } from '#/types';

export function refreshTokenOf(tokens: TokenSet): string {
  if (tokens.refreshToken === undefined) {
    throw new OduduError(
      'invalid_options',
      'these tokens carry no refresh token: Odudu issues one to a client that has the refresh_token grant, so sign in again with such a client',
    );
  }
  return tokens.refreshToken;
}

const UNKNOWN_OUTCOME =
  ' The outcome of that refresh is unknown, so this one was not sent: use the tokens the last successful refresh returned, or sign in again.';

// Only a refusal the server makes before it spends the refresh token leaves
// the token good. Any other failure (a lost connection, a 5xx, an ID token
// that is refused after the server rotated) may have spent it.
export function isRefusedBeforeSpending(error: unknown): boolean {
  return error instanceof OduduError && error.code === 'audience_not_granted';
}

// What a call queued behind such a failure is rejected with: the same code,
// and the words that say why nothing was sent.
export function abandoned(error: unknown): OduduError {
  if (error instanceof OduduError) {
    if (error.message.endsWith(UNKNOWN_OUTCOME)) return error;
    return new OduduError(error.code, `${error.message}${UNKNOWN_OUTCOME}`, {
      cause: error,
      ...(error.error === undefined ? {} : { error: error.error }),
      ...(error.errorDescription === undefined ? {} : { errorDescription: error.errorDescription }),
    });
  }
  return new OduduError('request_failed', `The refresh before this one failed.${UNKNOWN_OUTCOME}`, {
    cause: error,
  });
}

// A refresh for an audience the sign-in did not carry is refused here: the
// server would refuse it too, and asking costs a request and a rotation.
export function checkResource(tokens: TokenSet, resource: string | undefined): void {
  if (resource !== undefined && !Object.hasOwn(tokens.byAudience, resource)) {
    throw new OduduError(
      'audience_not_granted',
      'the sign-in does not carry this audience: use requestAudience to ask for it',
    );
  }
}

// The `aud` a JWT access token names, or undefined for one that is opaque or
// names no audience. The server puts every audience of the grant in one token,
// and leaves out one a registration policy has since taken away.
function audiencesNamedBy(accessToken: string): string[] | undefined {
  const payload = accessToken.split('.')[1];
  if (payload === undefined) return undefined;
  try {
    const bytes = Uint8Array.from(atob(payload.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
      c.charCodeAt(0),
    );
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const aud =
      typeof claims === 'object' && claims !== null && 'aud' in claims ? claims.aud : undefined;
    const named = (Array.isArray(aud) ? aud : [aud]).filter((a) => typeof a === 'string');
    return named.length === 0 ? undefined : named;
  } catch {
    return undefined;
  }
}

// The audiences a refresh without `resource` keeps: those of the sign-in that
// the new access token names, or all of them when it names none or cannot be
// read. Best effort: an access token is opaque to a client, and this reads it
// only because Odudu issues JWTs.
function renewedAudiences(previous: TokenSet, accessToken: string): string[] {
  const held = Object.keys(previous.byAudience);
  const named = audiencesNamedBy(accessToken)?.filter((audience) => held.includes(audience));
  return named === undefined || named.length === 0 ? held : named;
}

// The tokens after a refresh. Without a `resource` the new access token covers
// the audiences it names, so it replaces those entries and removes the others
// (a later request for one is `audience_not_granted`); with one it replaces
// that audience's entry and leaves the others. A refresh token the server did not rotate stays, and so do an ID
// token and claims it did not repeat.
export function refreshedTokenSet(
  previous: TokenSet,
  response: TokenEndpointResponse,
  claims: IDToken | undefined,
  resource: string | undefined,
  now: number,
): TokenSet {
  // OIDC Core section 12.2: a refreshed ID token names the same subject.
  if (claims !== undefined && claims.sub !== previous.claims.sub) {
    throw new OduduError('invalid_id_token', 'the refreshed ID token names another subject');
  }
  const accessToken = response.access_token;
  const expiresAt = refreshExpiresAtOf(response, now);
  const audiences = resource === undefined ? renewedAudiences(previous, accessToken) : [resource];
  const refreshToken = response.refresh_token ?? previous.refreshToken;
  return {
    byAudience: {
      ...(resource === undefined ? {} : previous.byAudience),
      ...Object.fromEntries(
        audiences.map((audience) => [
          audience,
          // A response without `scope` leaves the scope unchanged (RFC 6749 section 5.1).
          {
            accessToken,
            expiresAt,
            scope: response.scope ?? previous.byAudience[audience]?.scope ?? '',
          },
        ]),
      ),
    },
    idToken: response.id_token ?? previous.idToken,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    claims: claims ?? previous.claims,
    issuer: previous.issuer,
    clientId: previous.clientId,
  };
}
