import { type SigningKeyRecord } from '@odudu/crypto';
import { type RealmLookup } from '#/repository/realm-lookup';
import { subjectOfIdTokenHint } from '#/usecase/authorization-request';

export interface LogoutSession {
  id: string;
  subjectId: string;
}

export interface LogoutInput {
  hintSubject: string | null;
  // Back-Channel Logout §2.1's `sid`, read off the hint when it carries
  // one. A hint with no `sid` is a mismatch, never a fallback to comparing
  // subjects (docs/protocols/oidc-rpinitiated.md's reading note has why:
  // the one current token that lacks `sid` is an `offline_access` grant's,
  // which has no session to name).
  hintSid: string | null;
  session: LogoutSession | null;
  requested: string | null;
  registered: readonly string[];
}

export type LogoutDecision =
  | { kind: 'confirm' }
  | { kind: 'end'; redirectTo: string | null }
  | { kind: 'render'; error: string };

function decideRedirect(requested: string | null, registered: readonly string[]): LogoutDecision {
  if (requested === null) return { kind: 'end', redirectTo: null };
  return registered.includes(requested)
    ? { kind: 'end', redirectTo: requested }
    : { kind: 'render', error: 'invalid_request' };
}

// §2 and §3, both read in full in the reading note beside this file's own
// clause table (docs/protocols/oidc-rpinitiated.md): confirmation fires on
// either trigger, the redirect match is exact and unnormalized, and a
// matched redirect is honoured even with no session to end.
export function decideLogout(input: LogoutInput): LogoutDecision {
  if (input.session === null) {
    if (input.requested !== null && input.registered.includes(input.requested)) {
      return { kind: 'end', redirectTo: input.requested };
    }
    return { kind: 'confirm' };
  }

  const belongsToSession =
    input.hintSubject !== null && input.hintSid !== null && input.hintSid === input.session.id;

  if (!belongsToSession) return { kind: 'confirm' };

  return decideRedirect(input.requested, input.registered);
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
  // A session was ended, or there was none to end and the redirect alone
  // was honoured (see decideLogout). `sessionEnded` tells the route whether
  // there is a cookie to clear.
  | { kind: 'end'; redirectTo: string | null; state: string | null; sessionEnded: boolean }
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
  ): Promise<LogoutSession | null>;
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

  const session = await deps.resolveSession(realm, cookieValue);
  const hint =
    params.idTokenHint === null
      ? null
      : await subjectOfIdTokenHint(deps, realm.id, issuer, params.idTokenHint);
  const registered = await registeredUris(deps, realm.id, params.clientId);

  // §2: "When both `client_id` and `id_token_hint` are present, the OP MUST
  // verify that the Client Identifier matches the one used when issuing the
  // ID Token." A pair that disagrees is an error detected in the request, so
  // §4 applies to it: neither half is used, and the redirect the hint would
  // otherwise have authorised is dropped with it.
  const disagreeing =
    params.clientId !== null && hint !== null && !hint.audiences.includes(params.clientId);
  const requested = disagreeing ? null : params.postLogoutRedirectUri;

  const decision = decideLogout({
    hintSubject: disagreeing ? null : (hint?.subject ?? null),
    hintSid: disagreeing ? null : (hint?.sid ?? null),
    session,
    requested,
    registered,
  });

  if (decision.kind === 'confirm') {
    return {
      kind: 'confirm',
      sessionId: session?.id ?? null,
      clientId: params.clientId,
      postLogoutRedirectUri: requested,
      state: params.state,
    };
  }

  // `end` or `render` with no session means decideLogout honoured a
  // matched redirect with nothing to end (see its own comment) — there is
  // no session row to touch.
  if (session !== null) {
    await deps.endSession(realm.id, session.id, deps.now());
  }

  if (decision.kind === 'end') {
    return {
      kind: 'end',
      redirectTo: decision.redirectTo,
      state: params.state,
      sessionEnded: session !== null,
    };
  }
  return { kind: 'render', error: decision.error, state: params.state };
}

export interface LogoutConfirmationParams {
  // The value the confirmation form's hidden field carried — a
  // double-submit cookie check, not a single-use token: it *is* the
  // session cookie's own value, echoed back and compared against what the
  // cookie itself still resolves to. Only a browser holding that
  // HttpOnly cookie can supply a match, which is what stops a forged
  // cross-site POST from ending it.
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

  const session = await deps.resolveSession(realm, cookieValue);
  if (session?.id !== params.confirmedSessionId) {
    return { kind: 'unauthenticated' };
  }

  const registered = await registeredUris(deps, realm.id, params.clientId);
  // Forcing sid to the session's own id trivially satisfies decideLogout's
  // match — consent was already given by posting this form, so only the
  // redirect rule is still live.
  const decision = decideLogout({
    hintSubject: session.subjectId,
    hintSid: session.id,
    session,
    requested: params.postLogoutRedirectUri,
    registered,
  });

  await deps.endSession(realm.id, session.id, deps.now());

  if (decision.kind === 'end') {
    return {
      kind: 'end',
      redirectTo: decision.redirectTo,
      state: params.state,
      sessionEnded: true,
    };
  }
  if (decision.kind === 'render') {
    return { kind: 'render', error: decision.error, state: params.state };
  }
  throw new Error('unreachable: decideLogout asked to confirm a hint forced to match');
}
