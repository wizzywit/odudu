import { type SessionRecord } from '@odudu/authn-flows';
import { type SigningKeyRecord } from '@odudu/crypto';
import { type ClientLogoutTarget } from '#/repository/grants';
import { type RealmLookup } from '#/repository/realm-lookup';
import { frontChannelLogoutUrl } from '#/service/frontchannel-logout';
import { mostRecentlyActive } from '#/service/session-selection';
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
  // there is a cookie to clear. `frontChannelLogoutUrls` is non-empty only
  // when a session ended with nowhere to redirect to — the route then
  // renders it as the logged-out page's iframes (Front-Channel Logout 1.0
  // §3); a redirect leaves the page, and with it any chance an iframe on
  // it could load, so building the list would serve nothing there.
  | {
      kind: 'end';
      redirectTo: string | null;
      state: string | null;
      sessionEnded: boolean;
      frontChannelLogoutUrls: readonly string[];
    }
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
  // The browser's session cookies, resolved to their live rows exactly the
  // way /authorize resolves them — never trusted for anything but that
  // lookup.
  resolveSessions(
    realm: {
      id: string;
      name: string;
      ssoSessionIdleSeconds: number;
      ssoSessionMaxSeconds: number;
      rememberMeIdleSeconds: number;
      rememberMeMaxSeconds: number;
    },
    header: string | undefined,
  ): Promise<SessionRecord[]>;
  // One transaction: ends the session row and revokes every grant whose
  // session_id is that session (Back-Channel Logout §2.7). Access tokens
  // are not touched — see README.md's logout section for why not.
  endSession(realmId: string, sessionId: string, now: Date): Promise<void>;
  // Front-Channel Logout 1.0 §3's "set of logged-in RPs": the distinct
  // clients holding a grant issued under this session, with enough of each
  // one's logout metadata to build a front-channel logout URL for it.
  clientsForSession(realmId: string, sessionId: string): Promise<ClientLogoutTarget[]>;
  now(): Date;
}

function hasFrontChannelLogoutUri(
  target: ClientLogoutTarget,
): target is ClientLogoutTarget & { frontchannelLogoutUri: string } {
  return target.frontchannelLogoutUri !== null;
}

// Built only for the branch that is about to render the logged-out page —
// a redirect leaves the browser before any iframe on it could load, so
// there is nothing here for that branch to use.
async function frontChannelLogoutUrls(
  deps: LogoutUsecaseDeps,
  realmId: string,
  issuer: string,
  sessionId: string,
): Promise<readonly string[]> {
  const targets = await deps.clientsForSession(realmId, sessionId);
  const urls = targets
    .filter(hasFrontChannelLogoutUri)
    .map((target) =>
      frontChannelLogoutUrl(
        target.frontchannelLogoutUri,
        issuer,
        sessionId,
        target.frontchannelLogoutSessionRequired,
      ),
    );
  return urls.filter((url): url is string => url !== null);
}

async function registeredUris(
  deps: LogoutUsecaseDeps,
  realmId: string,
  clientId: string | null,
): Promise<readonly string[]> {
  if (clientId === null) return [];
  return deps.postLogoutRedirectUris(realmId, clientId);
}

// decideLogout decides over one session, while a browser may hold several.
// A hint that names a `sid` identifies which one the End-User asked to end,
// so it is matched against the resolved set first; mostRecentlyActive
// (#/service/session-selection) is only the fallback for a hint that names
// nothing usable, the same stand-in the reuse decision at /authorize makes.
function selectLogoutSession(
  sessions: readonly SessionRecord[],
  hintSid: string | null,
): SessionRecord | null {
  const named = hintSid === null ? undefined : sessions.find((session) => session.id === hintSid);
  return named ?? mostRecentlyActive(sessions);
}

function toLogoutSession(session: SessionRecord | null): LogoutSession | null {
  return session === null ? null : { id: session.id, subjectId: session.subjectId };
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
  header: string | undefined,
  params: LogoutRequestParams,
): Promise<LogoutOutcome> {
  const realm = await deps.findRealm(realmName);
  if (!realm?.enabled) return { kind: 'not_found' };

  const sessions = await deps.resolveSessions(
    {
      id: realm.id,
      name: realmName,
      ssoSessionIdleSeconds: realm.ssoSessionIdleSeconds,
      ssoSessionMaxSeconds: realm.ssoSessionMaxSeconds,
      rememberMeIdleSeconds: realm.rememberMeIdleSeconds,
      rememberMeMaxSeconds: realm.rememberMeMaxSeconds,
    },
    header,
  );
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
  const hintSid = disagreeing ? null : (hint?.sid ?? null);
  const session = toLogoutSession(selectLogoutSession(sessions, hintSid));

  const decision = decideLogout({
    hintSubject: disagreeing ? null : (hint?.subject ?? null),
    hintSid,
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
    const frontChannel =
      session !== null && decision.redirectTo === null
        ? await frontChannelLogoutUrls(deps, realm.id, issuer, session.id)
        : [];
    return {
      kind: 'end',
      redirectTo: decision.redirectTo,
      state: params.state,
      sessionEnded: session !== null,
      frontChannelLogoutUrls: frontChannel,
    };
  }
  return { kind: 'render', error: decision.error, state: params.state };
}

export interface LogoutConfirmationParams {
  // The value the confirmation form's hidden field carried — a
  // double-submit cookie check, not a single-use token: it *is* one of the
  // session cookies' own values, echoed back and checked for membership in
  // the set the cookies themselves still resolve to. Only a browser
  // holding an HttpOnly cookie can name a member, which is what stops a
  // forged cross-site POST from ending it.
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
  issuer: string,
  header: string | undefined,
  params: LogoutConfirmationParams,
): Promise<LogoutOutcome> {
  const realm = await deps.findRealm(realmName);
  if (!realm?.enabled) return { kind: 'not_found' };

  const sessions = await deps.resolveSessions(
    {
      id: realm.id,
      name: realmName,
      ssoSessionIdleSeconds: realm.ssoSessionIdleSeconds,
      ssoSessionMaxSeconds: realm.ssoSessionMaxSeconds,
      rememberMeIdleSeconds: realm.rememberMeIdleSeconds,
      rememberMeMaxSeconds: realm.rememberMeMaxSeconds,
    },
    header,
  );
  const confirmed = sessions.find((candidate) => candidate.id === params.confirmedSessionId);
  if (confirmed === undefined) {
    return { kind: 'unauthenticated' };
  }
  const session: LogoutSession = { id: confirmed.id, subjectId: confirmed.subjectId };

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
    const frontChannel =
      decision.redirectTo === null
        ? await frontChannelLogoutUrls(deps, realm.id, issuer, session.id)
        : [];
    return {
      kind: 'end',
      redirectTo: decision.redirectTo,
      state: params.state,
      sessionEnded: true,
      frontChannelLogoutUrls: frontChannel,
    };
  }
  if (decision.kind === 'render') {
    return { kind: 'render', error: decision.error, state: params.state };
  }
  throw new Error('unreachable: decideLogout asked to confirm a hint forced to match');
}
