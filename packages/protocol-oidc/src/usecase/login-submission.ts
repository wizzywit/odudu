import {
  type AdvanceInput,
  type AuthenticatorResult,
  type PendingRequest,
} from '@odudu/authn-flows';
import { type RealmScopedDatabase } from '@odudu/db';
import { authorizationCodeRepository } from '#/repository/codes';
import { type RealmLookup } from '#/repository/realm-lookup';
import { generateAuthorizationCode, hashAuthorizationCode } from '#/service/authorization-code';
import { realmIssuer } from '#/service/issuer';

// A code lives 60 seconds: it is redeemed by a backend within a second or
// two of the redirect, and a short window shrinks how long an intercepted
// code is worth anything.
const AUTHORIZATION_CODE_TTL_MS = 60_000;

export interface IssueAuthorizationCodeInput {
  realmId: string;
  clientId: string;
  subjectId: string;
  redirectUri: string;
  scope: string;
  nonce: string | null;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  // The `auth_time` claim this code's eventual ID Token carries — when the
  // End-User actually authenticated. On a fresh login this is the same
  // instant as `now`; on a reused session it is the session's own original
  // login, which can be arbitrarily far in the past.
  authTime: Date;
  // The instant this code is issued, which is what its 60s TTL counts from.
  // Deliberately separate from `authTime`: a code issued for a reused
  // session must still expire 60s from now, not 60s from a login that may
  // have happened minutes or hours ago.
  now: Date;
  // The SSO session this code's eventual grant is bound to — copied
  // forward so `/token` can carry it onto `token_grants.session_id`
  // without a lookup of its own. Null for an offline-scoped grant, which
  // by definition has no session.
  sessionId: string | null;
}

// Returns the raw code exactly once; only its hash is ever persisted.
export async function issueAuthorizationCode(
  tx: RealmScopedDatabase,
  input: IssueAuthorizationCodeInput,
): Promise<{ code: string }> {
  const code = generateAuthorizationCode();
  await authorizationCodeRepository(tx).create({
    codeHash: hashAuthorizationCode(code),
    realmId: input.realmId,
    clientId: input.clientId,
    subjectId: input.subjectId,
    redirectUri: input.redirectUri,
    scope: input.scope,
    nonce: input.nonce,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: input.codeChallengeMethod,
    authTime: input.authTime,
    expiresAt: new Date(input.now.getTime() + AUTHORIZATION_CODE_TTL_MS),
    sessionId: input.sessionId,
  });
  return { code };
}

export type LoginSubmissionOutcome =
  | { kind: 'unauthenticated' }
  | { kind: 'reject'; authSessionId: string }
  // The password was right, but the realm requires a verified address and
  // this one is not yet. Nothing is established and no code is issued; the
  // authentication session is left unconsumed so the same session can
  // retry once the address is verified. `hasEmail` is false for an account
  // with no address at all (every seeded-without-email account, once a
  // realm turns verify_email on) — the rendered page must not tell that
  // user mail was sent, since none was.
  | { kind: 'unverified'; authSessionId: string; hasEmail: boolean }
  // Authentication succeeded, and the request is still answered with an
  // error at the client's redirect_uri: no SSO session is established and no
  // code is issued, so there is no cookie to set either.
  | { kind: 'error_redirect'; location: string }
  | { kind: 'redirect'; location: string; sessionId: string };

// Everything the atomic completion step needs to establish the SSO session
// and issue the code, gathered ahead of the call so that step can be one
// transaction: consume the authentication session, then act on the result,
// with nothing else in between to roll back separately.
export interface CompleteLoginInput {
  realmId: string;
  authSessionId: string;
  subjectId: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  nonce: string | null;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  // The realm's configured SSO session ceiling, carried through so
  // completeLogin's establishSession call never needs a lookup of its own.
  ssoSessionMaxSeconds: number;
}

export type CompleteLoginOutcome =
  // The conditional consume found the session already used — by an earlier
  // request, or by one that raced this one to the same UPDATE — so nothing
  // was established or issued.
  { kind: 'already_consumed' } | { kind: 'issued'; sessionId: string; code: string };

// The gate is a property of completing a login, not of submitting a form.
// A realm requiring a verified address refuses a cookie-borne login for an
// unverified subject exactly as it refuses a password one; an unverified
// account that happens to hold a live session would otherwise sign in
// without ever passing the check.
export async function refusedForUnverifiedEmail(
  deps: Pick<LoginSubmissionDeps, 'checkEmailVerification'>,
  realm: { id: string; verifyEmail: boolean },
  subjectId: string,
): Promise<{ hasEmail: boolean } | null> {
  if (!realm.verifyEmail) return null;
  const status = await deps.checkEmailVerification(realm.id, subjectId);
  return status.verified ? null : { hasEmail: status.hasEmail };
}

export interface LoginSubmissionDeps {
  findRealm(name: string): Promise<RealmLookup | null>;
  advance(
    realmId: string,
    authSessionId: string,
    input: AdvanceInput,
  ): Promise<AuthenticatorResult>;
  loadPendingRequest(realmId: string, authSessionId: string): Promise<PendingRequest | null>;
  resolveClientId(realmId: string, oauthClientId: string): Promise<string | null>;
  // Read only when the realm's verify_email is on: the cost of an extra
  // lookup on every login is not worth paying for realms that never turn
  // it on. `hasEmail` lets the unverified page tell a null-address account
  // apart from an unverified one instead of claiming mail it never sent.
  checkEmailVerification(
    realmId: string,
    subjectId: string,
  ): Promise<{ verified: boolean; hasEmail: boolean }>;
  // Consumes the authentication session and, only if that succeeds,
  // establishes the SSO session and issues the authorization code — all in
  // the one transaction this name promises. See index.ts for the wiring
  // that makes it one `withRealm` call rather than three.
  completeLogin(input: CompleteLoginInput): Promise<CompleteLoginOutcome>;
}

// An authorization error response delivered to the parked request's own
// redirect_uri (OIDC Core §3.1.2.6), carrying `iss` for the same reason the
// success redirect does (RFC 9207 §2).
function errorRedirect(
  pending: PendingRequest,
  realmName: string,
  issuerBase: string,
  error: string,
): string {
  const location = new URL(pending.redirectUri);
  location.searchParams.set('error', error);
  if (pending.state !== null) location.searchParams.set('state', pending.state);
  location.searchParams.set('iss', realmIssuer(issuerBase, realmName));
  return location.toString();
}

// The handler this drives treats a submission whose auth_session_id does
// not name a live authentication session exactly as it treats a missing
// one — unauthenticated — because that hidden field is the whole of the
// login form's CSRF defence (see view/authorize-html.ts). Expiry and
// unknown-id are both folded into the same 'unauthenticated' outcome by
// advance()'s 'authentication_session_expired' failure reason; a wrong
// password (a live session, wrong credentials) is a distinct 'reject'
// outcome that lets the same session retry.
export async function handleLoginSubmission(
  deps: LoginSubmissionDeps,
  realmName: string,
  issuerBase: string,
  authSessionId: string | undefined,
  input: AdvanceInput,
): Promise<LoginSubmissionOutcome> {
  if (authSessionId === undefined || authSessionId.length === 0) {
    return { kind: 'unauthenticated' };
  }

  const realm = await deps.findRealm(realmName);
  if (!realm?.enabled) {
    return { kind: 'unauthenticated' };
  }

  const result = await deps.advance(realm.id, authSessionId, input);

  if (result.kind === 'failure' && result.reason === 'authentication_session_expired') {
    return { kind: 'unauthenticated' };
  }
  if (result.kind !== 'success') {
    return { kind: 'reject', authSessionId };
  }

  const refusal = await refusedForUnverifiedEmail(deps, realm, result.subjectId);
  if (refusal !== null) {
    return { kind: 'unverified', authSessionId, hasEmail: refusal.hasEmail };
  }

  // The only source of scope, redirect_uri, nonce, state and code_challenge
  // — never the request body. Resubmitting a wider scope or a different
  // redirect_uri with the form changes nothing: this is what is bound to
  // the code below.
  const pending = await deps.loadPendingRequest(realm.id, authSessionId);
  if (pending === null) {
    return { kind: 'unauthenticated' };
  }

  // OIDC Core §3.1.2.1: with an `id_token_hint`, a positive response is for
  // the End-User the hint identifies — one already logged in, or one who
  // "becomes logged in as a result of the request", which is the only case
  // this server has. Somebody else signing in is not that End-User, so the
  // request is answered with `login_required` and nothing is issued. The
  // authentication session is deliberately left unconsumed: the right
  // End-User can still sign in against the same parked request.
  const hintSubject = pending.idTokenHintSubject;
  if (hintSubject !== undefined && hintSubject !== result.subjectId) {
    return {
      kind: 'error_redirect',
      location: errorRedirect(pending, realmName, issuerBase, 'login_required'),
    };
  }

  const clientId = await deps.resolveClientId(realm.id, pending.clientId);
  if (clientId === null) {
    return { kind: 'unauthenticated' };
  }

  const completed = await deps.completeLogin({
    realmId: realm.id,
    authSessionId,
    subjectId: result.subjectId,
    clientId,
    redirectUri: pending.redirectUri,
    scope: pending.scope,
    nonce: pending.nonce,
    codeChallenge: pending.codeChallenge,
    codeChallengeMethod: pending.codeChallengeMethod,
    ssoSessionMaxSeconds: realm.ssoSessionMaxSeconds,
  });

  // A second submission of the same auth_session_id — a back-button press,
  // a retried POST — reaches here after advance() and loadPendingRequest()
  // both succeed again; completeLogin's atomic consume is what stops it
  // from minting a second SSO session and a second code for the same
  // parked request.
  if (completed.kind === 'already_consumed') {
    return { kind: 'unauthenticated' };
  }
  const { sessionId, code } = completed;

  const location = new URL(pending.redirectUri);
  location.searchParams.set('code', code);
  if (pending.state !== null) location.searchParams.set('state', pending.state);
  location.searchParams.set('iss', realmIssuer(issuerBase, realmName));

  return { kind: 'redirect', location: location.toString(), sessionId };
}
