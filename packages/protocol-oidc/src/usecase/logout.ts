import { type PresentedSession } from '@odudu/authn-flows';
import { type SigningKeyRecord } from '@odudu/crypto';
import { type RequestContext } from '@odudu/domain-audit';
import { type FrontChannelTarget } from '#/repository/grants';
import { type TenantLookup } from '#/repository/tenant-lookup';
import { frontChannelLogoutUrl, MAX_FRONT_CHANNEL_FRAMES } from '#/service/frontchannel-logout';
import { mostRecentlyActive } from '#/service/session-selection';
import { subjectOfLogoutHint } from '#/usecase/authorization-request';

export interface LogoutSession {
  id: string;
  subjectId: string;
}

// The hint, once its signature, issuer and key have verified and it names
// exactly one client and a session. Anything less reaches the decision as no
// hint at all.
export interface ValidHint {
  clientId: string;
  sid: string;
}

export interface LogoutClient {
  id: string;
  skipsConfirmation: boolean;
}

// A post_logout_redirect_uri that matches the client's registered list
// exactly (§3).
export interface RegisteredRedirect {
  uri: string;
}

export interface LogoutInput {
  session: { id: string } | null;
  hint: ValidHint | null;
  client: LogoutClient | null;
  redirect: RegisteredRedirect | null;
}

export type LogoutDecision =
  | { kind: 'confirm' }
  | { kind: 'end'; redirectTo: string | null }
  | { kind: 'render'; error: string };

export function decideRedirect(
  requested: string | null,
  registered: readonly string[],
): Exclude<LogoutDecision, { kind: 'confirm' }> {
  if (requested === null) return { kind: 'end', redirectTo: null };
  return registered.includes(requested)
    ? { kind: 'end', redirectTo: requested }
    : { kind: 'render', error: 'invalid_request' };
}

export type FirstContactDecision =
  | { kind: 'confirm' }
  // The session is ended without asking; the redirect is then judged as the
  // confirmation POST judges it.
  | { kind: 'end'; sessionEnds: true }
  | { kind: 'end'; sessionEnds: false; redirectTo: string };

// §2: the OP SHOULD ask the End-User, so a session present is ended on first
// contact only for a client whose operator turned the confirmation off
// (ADR 0047), and only for that client's own hint naming this very session.
// Every other hint only identifies which session to ask about
// (docs/protocols/oidc-rpinitiated.md). With no session there is nothing to
// end, and a matched redirect is still honoured so an RP is not stranded
// after an idle-out.
export function decideLogout(input: LogoutInput): FirstContactDecision {
  const { session, hint, client, redirect } = input;
  if (session === null) {
    return redirect === null
      ? { kind: 'confirm' }
      : { kind: 'end', sessionEnds: false, redirectTo: redirect.uri };
  }
  const skips =
    hint !== null &&
    client !== null &&
    client.skipsConfirmation &&
    hint.clientId === client.id &&
    hint.sid === session.id;
  return skips ? { kind: 'end', sessionEnds: true } : { kind: 'confirm' };
}

// `exp` is left unjudged by the reader, as for every logout hint, so a
// lapsed one still counts: what bounds it is the session its `sid` must name.
export function toValidHint(
  hint: { audiences: readonly string[]; sid: string | null } | null,
): ValidHint | null {
  const [only, ...rest] = hint?.audiences ?? [];
  const sid = hint?.sid ?? null;
  if (sid === null || only === undefined || rest.length > 0) return null;
  return { clientId: only, sid };
}

export function registeredRedirectOf(
  requested: string | null,
  registered: readonly string[],
): RegisteredRedirect | null {
  return requested !== null && registered.includes(requested) ? { uri: requested } : null;
}

export interface LogoutRequestParams {
  idTokenHint: string | null;
  clientId: string | null;
  postLogoutRedirectUri: string | null;
  state: string | null;
}

// `brandClientId` is the client whose theme the page wears: the one an
// `id_token_hint` verified for, never one a `client_id` parameter merely
// names, and null when there is none.
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
      // The same URI, only when it matches the client's registered list:
      // where the confirmation POST may redirect, and so what the page's
      // form-action has to license.
      registeredRedirect: string | null;
      state: string | null;
      brandClientId: string | null;
    }
  // The confirmation POST ended a session, or a first contact found none
  // to end and the registered redirect alone was honoured (see
  // decideLogout). `sessionEnded` tells the route whether there is a cookie
  // to clear. `frontChannelLogoutUrls` is empty when no session ended; with
  // a `redirectTo` it is the frames to show before the redirect
  // (Front-Channel Logout 1.0 §3).
  | {
      kind: 'end';
      redirectTo: string | null;
      state: string | null;
      sessionEnded: boolean;
      frontChannelLogoutUrls: readonly string[];
      brandClientId: string | null;
    }
  // Only the confirmation POST returns this: the redirect was refused, but
  // the session still ended and the page still renders — the same reason
  // `end`'s no-redirect branch frames its relying parties applies here too.
  | {
      kind: 'render';
      error: string;
      state: string | null;
      frontChannelLogoutUrls: readonly string[];
      brandClientId: string | null;
    };

export interface LogoutClientRecord extends LogoutClient {
  postLogoutRedirectUris: readonly string[];
}

export interface LogoutUsecaseDeps {
  findTenant(name: string): Promise<TenantLookup | null>;
  // Shared with /authorize's own hint validation — this tenant's own keys,
  // this tenant's issuer.
  listPublishableKeys(tenantId: string): Promise<SigningKeyRecord[]>;
  // A client (the request's `client_id`, else its hint's one audience) with
  // its registered post_logout_redirect_uris and whether it skips the
  // confirmation, read in one go. An unknown or disabled client yields null,
  // which refuses any redirect rather than resolving one with no client to
  // trust it against (§3) and never skips.
  logoutClient(tenantId: string, oauthClientId: string): Promise<LogoutClientRecord | null>;
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
  // that was never written. Access tokens are not touched: the RP-initiated
  // logout request path explains why not.
  endSession(
    tenantId: string,
    sessionId: string,
    subjectId: string,
    now: Date,
    issuer: string,
    request: RequestContext,
  ): Promise<void>;
  // Front-Channel Logout 1.0 §3's "set of logged-in RPs": the distinct
  // clients holding a grant issued under this session that registered a
  // front-channel logout URI, at most `limit` of them.
  frontChannelClientsForSession(
    tenantId: string,
    sessionId: string,
    limit: number,
  ): Promise<FrontChannelTarget[]>;
  now(): Date;
}

// Built for every branch that ends a session and renders a page, a
// redirecting one included: the frames load first and the page then sends
// the browser on (Front-Channel Logout 1.0 §3).
export async function frontChannelLogoutUrls(
  deps: Pick<LogoutUsecaseDeps, 'frontChannelClientsForSession'>,
  tenantId: string,
  issuer: string,
  sessionId: string,
): Promise<readonly string[]> {
  const targets = await deps.frontChannelClientsForSession(
    tenantId,
    sessionId,
    MAX_FRONT_CHANNEL_FRAMES,
  );
  const urls = targets.map((target) =>
    frontChannelLogoutUrl(
      target.frontchannelLogoutUri,
      issuer,
      sessionId,
      target.frontchannelLogoutSessionRequired,
    ),
  );
  return urls.filter((url): url is string => url !== null);
}

// §2 makes `client_id` optional. Without one, a hint that verified names the
// client it was issued to, but only when it names exactly one: a hint with
// several audiences says which of them is asking nowhere, so none is taken.
function clientOfRequest(
  clientId: string | null,
  hint: { audiences: readonly string[] } | null,
): string | null {
  if (clientId !== null) return clientId;
  const [only, ...rest] = hint?.audiences ?? [];
  return only !== undefined && rest.length === 0 ? only : null;
}

function logoutClientOf(
  deps: LogoutUsecaseDeps,
  tenantId: string,
  clientId: string | null,
): Promise<LogoutClientRecord | null> {
  return clientId === null ? Promise.resolve(null) : deps.logoutClient(tenantId, clientId);
}

// The confirmation concerns one session, while a browser may hold several.
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
// The same token for a form whose first contact verified its client by the
// hint. Which purpose proves is how the POST learns that, so a client_id the
// form merely carries can never choose a theme.
const LOGOUT_CONFIRMATION_BRANDED = 'logout-confirm-branded';

// The client whose theme a page may wear: the one a verified, agreeing hint
// was issued to, once it is a client this tenant has.
function brandedClient(
  hint: object | null,
  clientId: string | null,
  client: LogoutClientRecord | null,
): string | null {
  return hint !== null && client !== null ? clientId : null;
}

// A `GET` (or unconfirmed `POST`) against the logout endpoint: the first
// contact. A session is ended here only when decideLogout says the client
// opted out and the hint proves the request; otherwise the page asks, and
// nothing ends until the confirmation form is posted back to
// handleLogoutConfirmation.
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
  // The hint is read with `aud` unchecked and `exp` unjudged. `aud` is
  // compared by `disagreeing`, below: §4 requires a disagreeing
  // `client_id`/hint pair told apart from no usable hint at all, and the
  // reader returns `null` for every failure alike. `exp` is left to the
  // question of whether it names the live session (§2; the reading note in
  // docs/protocols/oidc-rpinitiated.md).
  const hint =
    params.idTokenHint === null
      ? null
      : await subjectOfLogoutHint(deps, tenant.id, issuer, params.idTokenHint);
  const clientId = clientOfRequest(params.clientId, hint);
  const client = await logoutClientOf(deps, tenant.id, clientId);
  const registered = client?.postLogoutRedirectUris ?? [];

  // §2: "When both `client_id` and `id_token_hint` are present, the OP MUST
  // verify that the Client Identifier matches the one used when issuing the
  // ID Token." A pair that disagrees is an error detected in the request, so
  // §4 applies to it: neither half is used, and the redirect the hint would
  // otherwise have authorised is dropped with it.
  const disagreeing =
    params.clientId !== null && hint !== null && !hint.audiences.includes(params.clientId);
  const requested = disagreeing ? null : params.postLogoutRedirectUri;
  const usableHint = disagreeing ? null : hint;
  const selected = selectLogoutSession(sessions, usableHint?.sid ?? null);
  const session = toLogoutSession(selected);
  const brandClientId = brandedClient(usableHint, clientId, client);

  const decision = decideLogout({
    session,
    hint: toValidHint(usableHint),
    client,
    redirect: registeredRedirectOf(requested, registered),
  });

  if (decision.kind === 'end' && decision.sessionEnds && session !== null) {
    return endAndAnswer(
      deps,
      tenant.id,
      issuer,
      session,
      requested,
      registered,
      params.state,
      request,
      brandClientId,
    );
  }
  if (decision.kind === 'end' && !decision.sessionEnds) {
    // Reached only with no session: a matched redirect with nothing to end.
    return {
      kind: 'end',
      redirectTo: decision.redirectTo,
      state: params.state,
      sessionEnded: false,
      frontChannelLogoutUrls: [],
      brandClientId,
    };
  }
  return {
    kind: 'confirm',
    sessionId: session?.id ?? null,
    csrf:
      selected?.entry.proof(
        brandClientId === null ? LOGOUT_CONFIRMATION : LOGOUT_CONFIRMATION_BRANDED,
        [clientId ?? '', requested ?? '', params.state ?? ''],
      ) ?? null,
    clientId,
    postLogoutRedirectUri: requested,
    registeredRedirect: registeredRedirectOf(requested, registered)?.uri ?? null,
    state: params.state,
    brandClientId,
  };
}

export interface LogoutConfirmationParams {
  // The session the form names, which must be one the cookie itself still
  // resolves to. It is public, so on its own it proves nothing.
  confirmedSessionId: string;
  // The form's anti-forgery token, which must be the one that session's
  // own presented entry proves (LOGOUT_CONFIRMATION) over the form's
  // client_id, post_logout_redirect_uri and state; empty when absent.
  csrf: string;
  clientId: string | null;
  postLogoutRedirectUri: string | null;
  state: string | null;
}

// The confirmation form's POST: the End-User has already said yes, so only
// the redirect rule (§3) is still live.
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
  const signed = [params.clientId ?? '', params.postLogoutRedirectUri ?? '', params.state ?? ''];
  const named = sessions.find((candidate) => candidate.id === params.confirmedSessionId);
  const branded = named?.entry.proves(LOGOUT_CONFIRMATION_BRANDED, params.csrf, signed) === true;
  const confirmed =
    branded || named?.entry.proves(LOGOUT_CONFIRMATION, params.csrf, signed) === true
      ? named
      : undefined;
  if (confirmed === undefined) {
    return { kind: 'unauthenticated' };
  }
  const session: LogoutSession = { id: confirmed.id, subjectId: confirmed.subjectId };

  const client = await logoutClientOf(deps, tenant.id, params.clientId);
  return endAndAnswer(
    deps,
    tenant.id,
    issuer,
    session,
    params.postLogoutRedirectUri,
    client?.postLogoutRedirectUris ?? [],
    params.state,
    request,
    branded && client !== null ? params.clientId : null,
  );
}

// The work that ends a session, shared by the confirmation POST and by the
// first contact of a client that skips the confirmation: end it, then judge
// the redirect (§3), which is the only rule still live once consent has been
// given or waived.
async function endAndAnswer(
  deps: LogoutUsecaseDeps,
  tenantId: string,
  issuer: string,
  session: LogoutSession,
  requested: string | null,
  registered: readonly string[],
  state: string | null,
  request: RequestContext,
  brandClientId: string | null,
): Promise<LogoutOutcome> {
  const decision = decideRedirect(requested, registered);

  await deps.endSession(tenantId, session.id, session.subjectId, deps.now(), issuer, request);

  const frontChannel = await frontChannelLogoutUrls(deps, tenantId, issuer, session.id);
  if (decision.kind === 'end') {
    return {
      kind: 'end',
      redirectTo: decision.redirectTo,
      state,
      sessionEnded: true,
      frontChannelLogoutUrls: frontChannel,
      brandClientId,
    };
  }
  return {
    kind: 'render',
    error: decision.error,
    state,
    frontChannelLogoutUrls: frontChannel,
    brandClientId,
  };
}
