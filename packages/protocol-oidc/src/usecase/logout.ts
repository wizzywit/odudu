import { type SigningKeyRecord } from '@odudu/crypto';
import { type RealmLookup } from '#/repository/realm-lookup';
import { subjectOfIdTokenHint } from '#/usecase/authorization-request';

export interface LogoutInput {
  hintSubject: string | null;
  sessionSubject: string | null;
  requested: string | null;
  registered: readonly string[];
}

export type LogoutDecision =
  | { kind: 'confirm' }
  | { kind: 'end'; redirectTo: string | null }
  | { kind: 'render'; error: string };

// RP-Initiated Logout 1.0 §2's confirmation MUST fires on either trigger —
// no hint at all, or a hint that does not name the session actually being
// ended, not just a missing one. §3's redirect MUST is exact string
// comparison against the client's registered values: no normalization, no
// case folding, no trailing-slash tolerance.
export function decideLogout(input: LogoutInput): LogoutDecision {
  if (input.hintSubject === null || input.hintSubject !== input.sessionSubject) {
    return { kind: 'confirm' };
  }
  if (input.requested === null) {
    return { kind: 'end', redirectTo: null };
  }
  return input.registered.includes(input.requested)
    ? { kind: 'end', redirectTo: input.requested }
    : { kind: 'render', error: 'invalid_request' };
}

export interface ResolvedLogoutSession {
  sessionId: string;
  subjectId: string;
}

export interface LogoutRequestParams {
  idTokenHint: string | null;
  clientId: string | null;
  postLogoutRedirectUri: string | null;
  state: string | null;
}

export type LogoutOutcome =
  | { kind: 'not_found' }
  // The confirmation form's whole CSRF defence failed: the hidden session
  // id posted back does not name the session the cookie itself resolves
  // to. Distinct from `render` below — nothing was ended, so the page must
  // not say it was.
  | { kind: 'unauthenticated' }
  | {
      kind: 'confirm';
      sessionId: string | null;
      clientId: string | null;
      postLogoutRedirectUri: string | null;
      state: string | null;
    }
  | { kind: 'end'; redirectTo: string | null; state: string | null }
  // The session named by `sessionId` at the point this outcome was reached
  // has already been ended — see handleLogoutRequest and
  // handleLogoutConfirmation below.
  | { kind: 'render'; error: string; state: string | null };

export interface LogoutUsecaseDeps {
  findRealm(name: string): Promise<RealmLookup | null>;
  // Shared with /authorize's own hint validation via subjectOfIdTokenHint —
  // this realm's own keys, this realm's issuer.
  listPublishableKeys(realmId: string): Promise<SigningKeyRecord[]>;
  // Resolved from an OAuth `client_id` to that client's registered
  // post_logout_redirect_uris; an unknown or unspecified client yields an
  // empty list, refusing any redirect rather than resolving one with no
  // client to trust it against (§3).
  postLogoutRedirectUris(realmId: string, oauthClientId: string): Promise<readonly string[]>;
  // The SSO session cookie's value, resolved to a live row exactly the way
  // /authorize resolves one — never trusted for anything but that lookup.
  resolveSession(
    realm: RealmLookup,
    cookieValue: string | undefined,
  ): Promise<ResolvedLogoutSession | null>;
  // One transaction: ends the session row and revokes every grant whose
  // session_id is that session (Back-Channel Logout §2.7). Access tokens
  // are not touched — see README.md's logout section for why not.
  endSession(realmId: string, sessionId: string, now: Date): Promise<void>;
  now(): Date;
}

async function registeredUris(
  deps: LogoutUsecaseDeps,
  realmId: string,
  clientId: string | null,
): Promise<readonly string[]> {
  if (clientId === null) return [];
  return deps.postLogoutRedirectUris(realmId, clientId);
}

// A `GET` (or unconfirmed `POST`) against the logout endpoint: the first
// contact, before anything has been ended. Ends the session immediately
// only when the hint already proves the End-User's intent (§2); otherwise
// asks, per the same section, and ends nothing until the confirmation form
// is posted back to handleLogoutConfirmation.
export async function handleLogoutRequest(
  deps: LogoutUsecaseDeps,
  realmName: string,
  issuer: string,
  cookieValue: string | undefined,
  params: LogoutRequestParams,
): Promise<LogoutOutcome> {
  const realm = await deps.findRealm(realmName);
  if (!realm?.enabled) return { kind: 'not_found' };

  const resolvedSession = await deps.resolveSession(realm, cookieValue);
  const hintSubject =
    params.idTokenHint === null
      ? null
      : await subjectOfIdTokenHint(deps, realm.id, issuer, params.idTokenHint);
  const registered = await registeredUris(deps, realm.id, params.clientId);

  const decision = decideLogout({
    hintSubject,
    sessionSubject: resolvedSession?.subjectId ?? null,
    requested: params.postLogoutRedirectUri,
    registered,
  });

  if (decision.kind === 'confirm') {
    return {
      kind: 'confirm',
      sessionId: resolvedSession?.sessionId ?? null,
      clientId: params.clientId,
      postLogoutRedirectUri: params.postLogoutRedirectUri,
      state: params.state,
    };
  }

  // decideLogout only reaches `end` or `render` when hintSubject matched
  // sessionSubject, and a match is only possible when both are non-null —
  // so a resolved session is guaranteed here.
  if (resolvedSession === null) {
    throw new Error('unreachable: decideLogout ended or refused logout with no resolved session');
  }
  await deps.endSession(realm.id, resolvedSession.sessionId, deps.now());

  if (decision.kind === 'end') {
    return { kind: 'end', redirectTo: decision.redirectTo, state: params.state };
  }
  return { kind: 'render', error: decision.error, state: params.state };
}

export interface LogoutConfirmationParams {
  // The value the confirmation form's hidden field carried — the same
  // protection auth_session_id gives the login form (ADR 0018's reading
  // note on rendered pages): only a browser that actually loaded the
  // confirmation page holds this value, and it must still name the session
  // the cookie itself resolves to.
  confirmedSessionId: string;
  clientId: string | null;
  postLogoutRedirectUri: string | null;
  state: string | null;
}

// The confirmation form's POST: the End-User has already said yes, so the
// hint-matching question decideLogout asks is moot — this function forces
// it to a match — but the redirect rule (§3) still applies exactly as it
// does on the immediate path.
export async function handleLogoutConfirmation(
  deps: LogoutUsecaseDeps,
  realmName: string,
  cookieValue: string | undefined,
  params: LogoutConfirmationParams,
): Promise<LogoutOutcome> {
  const realm = await deps.findRealm(realmName);
  if (!realm?.enabled) return { kind: 'not_found' };

  const resolvedSession = await deps.resolveSession(realm, cookieValue);
  if (resolvedSession?.sessionId !== params.confirmedSessionId) {
    return { kind: 'unauthenticated' };
  }

  const registered = await registeredUris(deps, realm.id, params.clientId);
  const decision = decideLogout({
    hintSubject: resolvedSession.subjectId,
    sessionSubject: resolvedSession.subjectId,
    requested: params.postLogoutRedirectUri,
    registered,
  });

  await deps.endSession(realm.id, resolvedSession.sessionId, deps.now());

  if (decision.kind === 'end') {
    return { kind: 'end', redirectTo: decision.redirectTo, state: params.state };
  }
  if (decision.kind === 'render') {
    return { kind: 'render', error: decision.error, state: params.state };
  }
  throw new Error('unreachable: decideLogout asked to confirm a hint forced to match');
}
