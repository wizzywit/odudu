import { type PresentedSession } from '@odudu/authn-flows';
import { AUDIENCE_UNCHECKED, type SigningKeyRecord } from '@odudu/crypto';
import { type RequestContext } from '@odudu/domain-audit';
import { type ClientLogoutTarget } from '#/repository/grants';
import { type TenantLookup } from '#/repository/tenant-lookup';
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
  // The confirmation POST named no session the cookie resolves to, or
  // carried no token that session's entry proves. Distinct from `render`
  // below — nothing was ended, so the page must not say it was.
  | { kind: 'unauthenticated' }
  | {
      kind: 'confirm';
      sessionId: string | null;
      // The anti-forgery token the form carries beside `sessionId`, null
      // exactly when `sessionId` is (see LOGOUT_CONFIRMATION).
      csrf: string | null;
      clientId: string | null;
      postLogoutRedirectUri: string | null;
      state: string | null;
    }
  // A session was ended, or there was none to end and the redirect alone
  // was honoured (see decideLogout). `sessionEnded` tells the route whether
  // there is a cookie to clear. `frontChannelLogoutUrls` is non-empty only
  // when `redirectTo` is null — a redirect leaves the page, and with it any
  // chance an iframe on it could load, so building the list would serve
  // nothing there (Front-Channel Logout 1.0 §3).
  | {
      kind: 'end';
      redirectTo: string | null;
      state: string | null;
      sessionEnded: boolean;
      frontChannelLogoutUrls: readonly string[];
    }
  // The redirect was refused, but the session still ended and the page
  // still renders — the same reason `end`'s no-redirect branch frames its
  // relying parties applies here too.
  | {
      kind: 'render';
      error: string;
      state: string | null;
      frontChannelLogoutUrls: readonly string[];
    };

export interface LogoutUsecaseDeps {
  findTenant(name: string): Promise<TenantLookup | null>;
  // Shared with /authorize's own hint validation via subjectOfIdTokenHint —
  // this tenant's own keys, this tenant's issuer.
  listPublishableKeys(tenantId: string): Promise<SigningKeyRecord[]>;
  // Resolved from an OAuth `client_id` to that client's registered
  // post_logout_redirect_uris; an unknown or unspecified client yields an
  // empty list, refusing any redirect rather than resolving one with no
  // client to trust it against (§3).
  postLogoutRedirectUris(tenantId: string, oauthClientId: string): Promise<readonly string[]>;
  // The browser's session cookies, resolved to their live rows exactly the
  // way /authorize resolves them — never trusted for anything but that
  // lookup.
  resolveSessions(
    tenant: {
      id: string;
      name: string;
      ssoSessionIdleSeconds: number;
      ssoSessionMaxSeconds: number;
      rememberMeIdleSeconds: number;
      rememberMeMaxSeconds: number;
    },
    header: string | undefined,
  ): Promise<PresentedSession[]>;
  // One transaction: ends the session row, revokes every grant whose
  // session_id is that session (Back-Channel Logout §2.7), and enqueues one
  // back-channel logout delivery per relying party that used the session
  // and registered a back-channel URI (§2.5). A failure anywhere — minting
  // or queuing a delivery included — rolls the whole transaction back, so a
  // session cannot end with a delivery lost: nothing would ever retry a row
  // that was never written. Access tokens are not touched — see README.md's
  // logout section for why not.
  endSession(
    tenantId: string,
    sessionId: string,
    subjectId: string,
    now: Date,
    issuer: string,
    request: RequestContext,
  ): Promise<void>;
  // Front-Channel Logout 1.0 §3's "set of logged-in RPs": the distinct
  // clients holding a grant issued under this session, with enough of each
  // one's logout metadata to build a front-channel logout URL for it.
  clientsForSession(tenantId: string, sessionId: string): Promise<ClientLogoutTarget[]>;
  now(): Date;
}

function hasFrontChannelLogoutUri(
  target: ClientLogoutTarget,
): target is ClientLogoutTarget & { frontchannelLogoutUri: string } {
  return target.frontchannelLogoutUri !== null;
}

// Built for either branch that is about to render a page rather than
// redirect — a redirect leaves the browser before any iframe on it could
// load, so there is nothing here for that branch to use.
async function frontChannelLogoutUrls(
  deps: LogoutUsecaseDeps,
  tenantId: string,
  issuer: string,
  sessionId: string,
): Promise<readonly string[]> {
  const targets = await deps.clientsForSession(tenantId, sessionId);
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
  tenantId: string,
  clientId: string | null,
): Promise<readonly string[]> {
  if (clientId === null) return [];
  return deps.postLogoutRedirectUris(tenantId, clientId);
}

// decideLogout decides over one session, while a browser may hold several.
// A hint that names a `sid` identifies which one the End-User asked to end,
// so it is matched against the resolved set first; mostRecentlyActive
// (#/service/session-selection) is only the fallback for a hint that names
// nothing usable, the same stand-in the reuse decision at /authorize makes.
function selectLogoutSession(
  sessions: readonly PresentedSession[],
  hintSid: string | null,
): PresentedSession | null {
  const named = hintSid === null ? undefined : sessions.find((session) => session.id === hintSid);
  if (named !== undefined) return named;
  const recent = mostRecentlyActive(sessions);
  return sessions.find((session) => session.id === recent?.id) ?? null;
}

function toLogoutSession(session: PresentedSession | null): LogoutSession | null {
  return session === null ? null : { id: session.id, subjectId: session.subjectId };
}

// The purpose the confirmation form's token is bound to. The session id it
// sits beside is public — every token for the session carries it as `sid`
// — so the token is an HMAC keyed by the secret half of the cookie's entry,
// which a cross-site forger cannot read (SessionEntry.proof).
const LOGOUT_CONFIRMATION = 'logout-confirm';

// A `GET` (or unconfirmed `POST`) against the logout endpoint: the first
// contact, before anything has been ended. Ends the session immediately
// only when the hint already proves the End-User's intent (§2); otherwise
// asks, per the same section, and ends nothing until the confirmation form
// is posted back to handleLogoutConfirmation.
export async function handleLogoutRequest(
  deps: LogoutUsecaseDeps,
  tenantName: string,
  issuer: string,
  header: string | undefined,
  params: LogoutRequestParams,
  request: RequestContext,
): Promise<LogoutOutcome> {
  const tenant = await deps.findTenant(tenantName);
  if (!tenant?.enabled) return { kind: 'not_found' };

  const sessions = await deps.resolveSessions(
    {
      id: tenant.id,
      name: tenantName,
      ssoSessionIdleSeconds: tenant.ssoSessionIdleSeconds,
      ssoSessionMaxSeconds: tenant.ssoSessionMaxSeconds,
      rememberMeIdleSeconds: tenant.rememberMeIdleSeconds,
      rememberMeMaxSeconds: tenant.rememberMeMaxSeconds,
    },
    header,
  );
  // AUDIENCE_UNCHECKED here does not mean this door leaves `aud`
  // unexamined — §4 requires a disagreeing `client_id`/hint pair told apart
  // from no usable hint at all, and `subjectOfIdTokenHint` returns `null`
  // for every failure alike, so a mismatch refused inside verification
  // would be indistinguishable from an absent hint. `disagreeing`, below,
  // makes that comparison where the caller can still see which case it is.
  const hint =
    params.idTokenHint === null
      ? null
      : await subjectOfIdTokenHint(deps, tenant.id, issuer, params.idTokenHint, AUDIENCE_UNCHECKED);
  const registered = await registeredUris(deps, tenant.id, params.clientId);

  // §2: "When both `client_id` and `id_token_hint` are present, the OP MUST
  // verify that the Client Identifier matches the one used when issuing the
  // ID Token." A pair that disagrees is an error detected in the request, so
  // §4 applies to it: neither half is used, and the redirect the hint would
  // otherwise have authorised is dropped with it.
  const disagreeing =
    params.clientId !== null && hint !== null && !hint.audiences.includes(params.clientId);
  const requested = disagreeing ? null : params.postLogoutRedirectUri;
  const hintSid = disagreeing ? null : (hint?.sid ?? null);
  const selected = selectLogoutSession(sessions, hintSid);
  const session = toLogoutSession(selected);

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
      csrf: selected?.entry.proof(LOGOUT_CONFIRMATION) ?? null,
      clientId: params.clientId,
      postLogoutRedirectUri: requested,
      state: params.state,
    };
  }

  // `end` or `render` with no session means decideLogout honoured a
  // matched redirect with nothing to end (see its own comment) — there is
  // no session row to touch.
  if (session !== null) {
    await deps.endSession(tenant.id, session.id, session.subjectId, deps.now(), issuer, request);
  }

  if (decision.kind === 'end') {
    const frontChannel =
      session !== null && decision.redirectTo === null
        ? await frontChannelLogoutUrls(deps, tenant.id, issuer, session.id)
        : [];
    return {
      kind: 'end',
      redirectTo: decision.redirectTo,
      state: params.state,
      sessionEnded: session !== null,
      frontChannelLogoutUrls: frontChannel,
    };
  }
  // decideRedirect only refuses inside decideLogout's already-matched-
  // session branch (see the comment above), but the type still admits
  // `null` here.
  const refusedFrontChannel =
    session !== null ? await frontChannelLogoutUrls(deps, tenant.id, issuer, session.id) : [];
  return {
    kind: 'render',
    error: decision.error,
    state: params.state,
    frontChannelLogoutUrls: refusedFrontChannel,
  };
}

export interface LogoutConfirmationParams {
  // The session the form names, which must be one the cookie itself still
  // resolves to. It is public, so on its own it proves nothing.
  confirmedSessionId: string;
  // The form's anti-forgery token, which must be the one that session's
  // own presented entry proves (LOGOUT_CONFIRMATION); empty when absent.
  csrf: string;
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
  tenantName: string,
  issuer: string,
  header: string | undefined,
  params: LogoutConfirmationParams,
  request: RequestContext,
): Promise<LogoutOutcome> {
  const tenant = await deps.findTenant(tenantName);
  if (!tenant?.enabled) return { kind: 'not_found' };

  const sessions = await deps.resolveSessions(
    {
      id: tenant.id,
      name: tenantName,
      ssoSessionIdleSeconds: tenant.ssoSessionIdleSeconds,
      ssoSessionMaxSeconds: tenant.ssoSessionMaxSeconds,
      rememberMeIdleSeconds: tenant.rememberMeIdleSeconds,
      rememberMeMaxSeconds: tenant.rememberMeMaxSeconds,
    },
    header,
  );
  const confirmed = sessions.find(
    (candidate) =>
      candidate.id === params.confirmedSessionId &&
      candidate.entry.proves(LOGOUT_CONFIRMATION, params.csrf),
  );
  if (confirmed === undefined) {
    return { kind: 'unauthenticated' };
  }
  const session: LogoutSession = { id: confirmed.id, subjectId: confirmed.subjectId };

  const registered = await registeredUris(deps, tenant.id, params.clientId);
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

  await deps.endSession(tenant.id, session.id, session.subjectId, deps.now(), issuer, request);

  if (decision.kind === 'end') {
    const frontChannel =
      decision.redirectTo === null
        ? await frontChannelLogoutUrls(deps, tenant.id, issuer, session.id)
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
    const refusedFrontChannel = await frontChannelLogoutUrls(deps, tenant.id, issuer, session.id);
    return {
      kind: 'render',
      error: decision.error,
      state: params.state,
      frontChannelLogoutUrls: refusedFrontChannel,
    };
  }
  throw new Error('unreachable: decideLogout asked to confirm a hint forced to match');
}
