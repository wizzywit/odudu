import { unwrapSecret, verifyJwtClaims, wrapSecret } from '@odudu/crypto';
import { withTenant } from '@odudu/db';
import { ADMIN_CLIENT_ID } from '@odudu/domain-tenant';
import { consoleLoginRepository, type ConsoleLoginRecord } from '#/repository/console-logins';
import { consoleSessionRepository } from '#/repository/console-sessions';
import { tenantNameRepository } from '#/repository/tenants';
import { subjectOfIdToken } from '#/service/id-token';
import { type Caller, type TokenSet } from '#/service/odudu-port';
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
import { endGrant } from '#/usecase/end-grant';
import { endNamedSession, type ResolveSessionDeps } from '#/usecase/resolve-session';

export interface CompleteLoginDeps extends LoginDeps, ResolveSessionDeps {}

export interface Callback {
  readonly code: string | undefined;
  readonly state: string | undefined;
  readonly iss: string | undefined;
  readonly error: string | undefined;
  readonly loginCookie: string | undefined;
  /** The whole `Cookie` header, for a console session this sign-in replaces. */
  readonly cookieHeader: string | undefined;
  readonly from: Caller;
  readonly now: Date;
}

export type CallbackResult =
  | {
      readonly kind: 'signed-in';
      readonly sessionCookie: string;
      readonly location: string;
      // Why the session this sign-in replaced could not be ended, by kind only.
      readonly replacedFailure?: FailureKind;
    }
  | { readonly kind: 'op-error'; readonly location: string }
  // Where to begin the sign-in again, or null for a callback that carried
  // no state, which no sign-in of this console's could have produced.
  | { readonly kind: 'refused'; readonly restart: string | null };

const CONSOLE = '/console/';

// The same answer for every refusal, so it says nothing of the check that
// failed: the sign-in of the tenant the state is bound to, never the code.
async function refused(deps: LoginDeps, state: string | undefined): Promise<CallbackResult> {
  if (state === undefined) return { kind: 'refused', restart: null };
  const bound = splitTenantBound(state);
  if (bound === null) return { kind: 'refused', restart: CONSOLE };
  const name = await withTenant(deps.database.db, bound.tenantId, (tx) =>
    tenantNameRepository(tx).nameOf(bound.tenantId),
  );
  if (name === null) return { kind: 'refused', restart: CONSOLE };
  return {
    kind: 'refused',
    restart: `/console/auth/login?${new URLSearchParams({ tenant: name }).toString()}`,
  };
}

export interface FailureKind {
  readonly type: string;
  readonly code: string | undefined;
}

// A driver's message carries the statement's parameters, so a failure is
// reported by its kind and the database's code, found on it or its cause.
function kindOf(error: unknown): FailureKind {
  const code = (value: unknown): string | undefined => {
    if (typeof value !== 'object' || value === null || !('code' in value)) return undefined;
    return typeof value.code === 'string' ? value.code : undefined;
  };
  const cause = error instanceof Error ? error.cause : undefined;
  return {
    type: error instanceof Error ? error.name : typeof error,
    code: code(error) ?? code(cause),
  };
}

// RFC 6749 §4.1.2.1's codes and OIDC Core §3.1.2.6's. Anything else is
// reported as server_error rather than carried into the address bar.
const OP_ERROR_CODES: ReadonlySet<string> = new Set([
  'invalid_request',
  'unauthorized_client',
  'access_denied',
  'unsupported_response_type',
  'invalid_scope',
  'server_error',
  'temporarily_unavailable',
  'interaction_required',
  'login_required',
  'account_selection_required',
  'consent_required',
  'invalid_request_uri',
  'invalid_request_object',
  'request_not_supported',
  'request_uri_not_supported',
  'registration_not_supported',
]);

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
    const code = OP_ERROR_CODES.has(input.error) ? input.error : 'server_error';
    await takeLogin(deps, input.state, input.loginCookie, input.now);
    return { kind: 'op-error', location: `/console/?login_error=${code}` };
  }

  const taken = await takeLogin(deps, input.state, input.loginCookie, input.now);
  if (taken === null || input.code === undefined) return refused(deps, input.state);
  const { login, tenantName } = taken;

  // RFC 9207 §2.4: the authorization response names its issuer, and one
  // naming any other tenant's is a mix-up.
  const issuer = await deps.odudu.issuerOf(tenantName, input.from);
  if (issuer === null || input.iss !== issuer) return refused(deps, input.state);

  const tokens = await deps.odudu.exchangeCode({
    tenant: tenantName,
    code: input.code,
    verifier: unwrapSecret(login.verifierWrapped, deps.kek),
    redirectUri: callbackUri(deps.base),
    from: input.from,
  });
  if (tokens === null) return refused(deps, input.state);

  // From here a live grant exists, and a sign-in that stops short of a
  // session, by refusal or by a throw, must not leave it behind.
  let signedIn: SignedIn | null;
  try {
    signedIn = await admitTokens(deps, input, taken, issuer, tokens);
  } catch (error: unknown) {
    await endGrant(deps.odudu, tenantName, tokens.refreshToken, input.from);
    throw error;
  }
  if (signedIn === null) {
    await endGrant(deps.odudu, tenantName, tokens.refreshToken, input.from);
    return refused(deps, input.state);
  }
  const replacedFailure = await endReplacedSession(deps, input);
  return replacedFailure === null ? signedIn : { ...signedIn, replacedFailure };
}

// One console session per browser, so a sign-in ends the one its cookie
// named, but only once the new session exists: a refused or abandoned
// sign-in leaves the administrator where they were. Past that point it is
// best effort, whatever fails: the new cookie replaces the old one in this
// browser, and a row left behind idles out.
async function endReplacedSession(
  deps: CompleteLoginDeps,
  input: Callback,
): Promise<FailureKind | null> {
  try {
    await endNamedSession(deps, input.cookieHeader, input.from);
    return null;
  } catch (error: unknown) {
    return kindOf(error);
  }
}

type SignedIn = Extract<CallbackResult, { kind: 'signed-in' }>;

async function admitTokens(
  deps: CompleteLoginDeps,
  input: Callback,
  { login, tenantName }: TakenLogin,
  issuer: string,
  tokens: TokenSet,
): Promise<SignedIn | null> {
  const keys = await deps.odudu.keysOf(tenantName, input.from);
  const claims = await verifyJwtClaims(tokens.idToken, keys, {
    issuer,
    audience: ADMIN_CLIENT_ID,
    now: input.now,
    algorithms: ID_TOKEN_ALGORITHMS,
  });
  const sub =
    claims === null
      ? null
      : subjectOfIdToken(claims, { nonce: login.nonce, clientId: ADMIN_CLIENT_ID, now: input.now });
  if (sub === null) return null;

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
