import {
  type AdvanceInput,
  type AuthenticatorResult,
  type PendingRequest,
} from '@odudu/authn-flows';
import { type RealmScopedDatabase } from '@odudu/db';
import { authorizationCodeRepository } from '#/repository/codes';
import { type RealmLookup } from '#/repository/realm-lookup';
import { generateAuthorizationCode, hashAuthorizationCode } from '#/service/authorization-code';

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
  authTime: Date;
}

// Returns the raw code exactly once; only its hash is ever persisted.
// `expiresAt` is derived from `input.authTime`, not a fresh clock read, so
// the TTL stored is exactly 60s by construction: both columns come from the
// one `now` the caller captured, never two separate clock reads that could
// straddle a millisecond boundary.
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
    expiresAt: new Date(input.authTime.getTime() + AUTHORIZATION_CODE_TTL_MS),
  });
  return { code };
}

export type LoginSubmissionOutcome =
  | { kind: 'unauthenticated' }
  | { kind: 'reject'; authSessionId: string }
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
}

export type CompleteLoginOutcome =
  // The conditional consume found the session already used — by an earlier
  // request, or by one that raced this one to the same UPDATE — so nothing
  // was established or issued.
  { kind: 'already_consumed' } | { kind: 'issued'; sessionId: string; code: string };

export interface LoginSubmissionDeps {
  findRealm(name: string): Promise<RealmLookup | null>;
  advance(
    realmId: string,
    authSessionId: string,
    input: AdvanceInput,
  ): Promise<AuthenticatorResult>;
  loadPendingRequest(realmId: string, authSessionId: string): Promise<PendingRequest | null>;
  resolveClientId(realmId: string, oauthClientId: string): Promise<string | null>;
  // Consumes the authentication session and, only if that succeeds,
  // establishes the SSO session and issues the authorization code — all in
  // the one transaction this name promises. See index.ts for the wiring
  // that makes it one `withRealm` call rather than three.
  completeLogin(input: CompleteLoginInput): Promise<CompleteLoginOutcome>;
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

  // The only source of scope, redirect_uri, nonce, state and code_challenge
  // — never the request body. Resubmitting a wider scope or a different
  // redirect_uri with the form changes nothing: this is what is bound to
  // the code below.
  const pending = await deps.loadPendingRequest(realm.id, authSessionId);
  if (pending === null) {
    return { kind: 'unauthenticated' };
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
  // Matches discoveryDocument()'s issuer exactly: `${issuerBase}/realms/${realmName}`.
  location.searchParams.set('iss', `${issuerBase}/realms/${realmName}`);

  return { kind: 'redirect', location: location.toString(), sessionId };
}
