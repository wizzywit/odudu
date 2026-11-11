import { addressPath, type TenantAddress } from '@odudu/kernel';
import { type PendingRequest } from '@odudu/authn-flows';
import { requestedActionOf } from '#/service/action-request';
import { MAX_CLAIMS_PARAMETER_BYTES } from '#/service/claims-request';

type ParkedClaims = NonNullable<PendingRequest['claims']>;

function claimsParameter(claims: ParkedClaims): string | null {
  const member = (entries: ParkedClaims['idToken']) =>
    Object.fromEntries(
      Object.entries(entries).map(([name, entry]) => [
        name,
        !entry.essential && entry.value === undefined && entry.values === undefined
          ? null
          : {
              ...(entry.essential ? { essential: true } : {}),
              ...(entry.value !== undefined ? { value: entry.value } : {}),
              ...(entry.values !== undefined ? { values: entry.values } : {}),
            },
      ]),
    );
  const idToken = member(claims.idToken);
  const userinfo = member(claims.userinfo);
  if (Object.keys(idToken).length === 0 && Object.keys(userinfo).length === 0) return '';
  const raw = JSON.stringify({
    ...(Object.keys(idToken).length > 0 ? { id_token: idToken } : {}),
    ...(Object.keys(userinfo).length > 0 ? { userinfo } : {}),
  });
  return Buffer.byteLength(raw, 'utf8') > MAX_CLAIMS_PARAMETER_BYTES ? null : raw;
}

// A path on this server, never a foreign URL: the one place a request that
// already passed /authorize is turned back into a link, so a sign-in that
// expired can be started again. /authorize validates it from scratch.
// Null when the parked request cannot be rebuilt faithfully: the hint token
// itself is not stored, only whom it named, and a rebuilt request without
// it would no longer be constrained to that subject.
export function restartAuthorizeLocation(
  address: TenantAddress,
  pending: PendingRequest,
): string | null {
  if (pending.idTokenHintSubject !== undefined || pending.claimsSubject !== undefined) return null;
  const claims = pending.claims === undefined ? '' : claimsParameter(pending.claims);
  if (claims === null) return null;

  const query = new URLSearchParams({
    response_type: 'code',
    client_id: pending.clientId,
    redirect_uri: pending.redirectUri,
    scope: pending.scope,
    code_challenge: pending.codeChallenge,
    code_challenge_method: pending.codeChallengeMethod,
  });
  if (pending.state !== null) query.set('state', pending.state);
  if (pending.nonce !== null) query.set('nonce', pending.nonce);
  // A request that asked for the registration page (prompt=create) comes
  // back as a sign-in once the person has registered, and one that asks for
  // credentials: the account they just made, not a session the browser
  // already had.
  const prompt = [
    ...new Set((pending.prompt ?? []).map((value) => (value === 'create' ? 'login' : value))),
  ];
  if (prompt.length > 0) query.set('prompt', prompt.join(' '));
  if (pending.maxAge !== undefined) query.set('max_age', String(pending.maxAge));
  if (pending.uiLocales !== undefined && pending.uiLocales.length > 0) {
    query.set('ui_locales', pending.uiLocales.join(' '));
  }
  // Several resolved audiences mean the client sent none and the registered
  // list applied; naming them all would be refused as invalid_target.
  if (pending.resource?.length === 1) query.set('resource', pending.resource[0] ?? '');
  if (claims !== '') query.set('claims', claims);
  const action = requestedActionOf(pending);
  if (action !== null) query.set('action', action);
  return addressPath(address, `/protocol/openid-connect/auth?${query.toString()}`);
}
