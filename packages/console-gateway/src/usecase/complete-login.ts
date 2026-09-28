import { unwrapSecret, verifyJwtClaims, wrapSecret } from '@odudu/crypto';
import { withTenant } from '@odudu/db';
import { ADMIN_CLIENT_ID } from '@odudu/domain-tenant';
import { isUuid } from '@odudu/kernel';
import { consoleLoginRepository, type ConsoleLoginRecord } from '#/repository/console-logins';
import { consoleSessionRepository } from '#/repository/console-sessions';
import { tenantNameRepository } from '#/repository/tenants';
import { type OduduPort } from '#/service/odudu-port';
import { safeReturnTo } from '#/service/return-to';
import {
  bindToTenant,
  randomSecret,
  sameSecret,
  sha256,
  splitTenantBound,
} from '#/service/secrets';
import { CONSOLE_SESSION_ABSOLUTE_SECONDS } from '#/service/session-lifetime';
import { callbackUri, type LoginDeps } from '#/usecase/begin-login';

export interface CompleteLoginDeps extends LoginDeps {
  readonly odudu: OduduPort;
}

export interface Callback {
  readonly code: string | undefined;
  readonly state: string | undefined;
  readonly iss: string | undefined;
  readonly error: string | undefined;
  readonly loginCookie: string | undefined;
  readonly ip: string;
  readonly now: Date;
}

export type CallbackResult =
  | { readonly kind: 'signed-in'; readonly sessionCookie: string; readonly location: string }
  | { readonly kind: 'op-error'; readonly location: string }
  | { readonly kind: 'refused' };

const REFUSED: CallbackResult = { kind: 'refused' };

// RFC 6749 §4.1.2.1's registered codes are all of this shape. Anything else
// is dropped rather than carried into the console's address bar.
const ERROR_CODE = /^[a-z_]{1,64}$/u;

const ID_TOKEN_ALGORITHMS = ['RS256', 'ES256'] as const;

interface TakenLogin {
  readonly login: ConsoleLoginRecord;
  readonly tenantName: string;
}

// The state is bound to this browser by the login cookie; one that does not
// match it is refused before anything is read, so a forged callback cannot
// spend another browser's pending login.
async function takeLogin(
  deps: LoginDeps,
  state: string | undefined,
  cookie: string | undefined,
  now: Date,
): Promise<TakenLogin | null> {
  if (state === undefined || cookie === undefined || !sameSecret(state, cookie)) return null;
  const bound = splitTenantBound(state);
  if (bound === null) return null;
  return withTenant(deps.database.db, bound.tenantId, async (tx) => {
    const login = await consoleLoginRepository(tx).takeByStateHash(sha256(state), now);
    if (login === null) return null;
    const tenantName = await tenantNameRepository(tx).nameOf(bound.tenantId);
    return tenantName === null ? null : { login, tenantName };
  });
}

export async function completeLogin(
  deps: CompleteLoginDeps,
  input: Callback,
): Promise<CallbackResult> {
  if (input.error !== undefined) {
    if (!ERROR_CODE.test(input.error)) return REFUSED;
    await takeLogin(deps, input.state, input.loginCookie, input.now);
    return { kind: 'op-error', location: `/console/?login_error=${input.error}` };
  }

  const taken = await takeLogin(deps, input.state, input.loginCookie, input.now);
  if (taken === null || input.code === undefined) return REFUSED;
  const { login, tenantName } = taken;

  // RFC 9207 §2.4: the authorization response names its issuer, and one
  // naming any other tenant's is a mix-up.
  const issuer = await deps.odudu.issuerOf(tenantName, input.ip);
  if (issuer === null || input.iss !== issuer) return REFUSED;

  const tokens = await deps.odudu.exchangeCode({
    tenant: tenantName,
    code: input.code,
    verifier: unwrapSecret(login.verifierWrapped, deps.kek),
    redirectUri: callbackUri(deps.base),
    ip: input.ip,
  });
  if (tokens === null) return REFUSED;

  const claims = await verifyJwtClaims(
    tokens.idToken,
    await deps.odudu.keysOf(tenantName, input.ip),
    { issuer, audience: ADMIN_CLIENT_ID, now: input.now, algorithms: ID_TOKEN_ALGORITHMS },
  );
  if (claims === null) return REFUSED;
  const { nonce, sub } = claims;
  if (typeof nonce !== 'string' || !sameSecret(nonce, login.nonce)) return REFUSED;
  if (typeof sub !== 'string' || !isUuid(sub)) return REFUSED;

  const secret = randomSecret();
  const now = input.now.getTime();
  await withTenant(deps.database.db, login.tenantId, (tx) =>
    consoleSessionRepository(tx).create({
      tenantId: login.tenantId,
      subjectId: sub,
      secretHash: sha256(secret),
      tokens: {
        accessTokenWrapped: wrapSecret(tokens.accessToken, deps.kek),
        refreshTokenWrapped: wrapSecret(tokens.refreshToken, deps.kek),
        accessExpiresAt: new Date(now + tokens.expiresInSeconds * 1000),
      },
      // A refresh response carries no ID token, and logout needs this one
      // as its hint for the whole life of the session.
      idTokenWrapped: wrapSecret(tokens.idToken, deps.kek),
      now: input.now,
      expiresAt: new Date(now + CONSOLE_SESSION_ABSOLUTE_SECONDS * 1000),
    }),
  );
  return {
    kind: 'signed-in',
    sessionCookie: bindToTenant(login.tenantId, secret),
    location: safeReturnTo(login.returnTo),
  };
}
