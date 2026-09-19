import {
  nextRequiredAction,
  type AdvanceInput,
  type AdvanceOutcome,
  type PendingRequest,
  type RequiredAction,
  type SessionRecord,
} from '@odudu/authn-flows';
import { type RealmScopedDatabase } from '@odudu/db';
import { isUuid } from '@odudu/kernel';
import { authorizationCodeRepository } from '#/repository/codes';
import { type RealmLookup } from '#/repository/realm-lookup';
import { generateAuthorizationCode, hashAuthorizationCode } from '#/service/authorization-code';
import { decideConsent } from '#/service/consent';
import { realmIssuer } from '#/service/issuer';
import { type PromptValue } from '#/service/prompt';

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
  // `reason` is present only where the refusal says something the person at
  // the form can act on. A wrong password says nothing on purpose — which
  // account exists is not theirs to learn — but a spent recovery code is
  // their own credential, on an attempt already bound to them, and "try the
  // next one" is the difference between that and abandoning the list.
  | { kind: 'reject'; authSessionId: string; reason?: string }
  // The password was right, but the realm requires a verified address and
  // this one is not yet. Nothing is established and no code is issued; the
  // authentication session is left unconsumed so the same session can
  // retry once the address is verified. `hasEmail` is false for an account
  // with no address at all (every seeded-without-email account, once a
  // realm turns verify_email on) — the rendered page must not tell that
  // user mail was sent, since none was.
  | { kind: 'unverified'; authSessionId: string; hasEmail: boolean }
  // Authentication succeeded, but a required action is still owed. Nothing
  // is established and no code is issued, for the same reason as
  // 'unverified' above; the authentication session is left unconsumed so
  // the same session resumes once the action is complete. See
  // #/usecase/executor.ts's comment above recordSatisfied for why this has
  // to be decided before completeLogin, never after.
  | {
      kind: 'required_action';
      authSessionId: string;
      subjectId: string;
      action: RequiredAction;
    }
  // Authentication succeeded, and the request is still answered with an
  // error at the client's redirect_uri: no SSO session is established and no
  // code is issued, so there is no cookie to set either.
  | { kind: 'error_redirect'; location: string }
  // The subject is fully authenticated and owes nothing else, but consent
  // has not been recorded for everything requested (or prompt=consent asked
  // again regardless). Nothing is established and no code is issued, for
  // the same reason as 'unverified' and 'required_action' above; the
  // authentication session is left unconsumed so the consent POST resumes
  // the same parked request.
  | {
      kind: 'consent';
      authSessionId: string;
      clientName: string;
      defaultScopes: string[];
      optionalScopes: string[];
      alreadyGranted: string[];
    }
  | {
      kind: 'redirect';
      location: string;
      sessionId: string;
      // What sessionCookies (the one authority for the cookie, @odudu/authn-flows)
      // needs to write both lists: this login's session joined with the
      // browser's other surviving ones, split by which cookie already
      // carries each. Persistent is always empty until a login can ask to
      // be remembered.
      ephemeralSessionIds: readonly string[];
      persistentSessionIds: readonly string[];
      persistentMaxAgeSeconds: number;
    };

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
  // What `advance` reported ran, in order — copied onto the session
  // establishSession creates, so a later reuse of it states `amr`/`acr`
  // about what this login actually used rather than what the subject
  // could use by the time it is reused. Ignored when `reuseSession` is
  // present: that session's own `amr`/`acr` were set at its own login.
  authenticators: string[];
  // Present only when this completion is a session reuse a consent
  // decision promoted (see PendingRequest.reuseSessionId): touch and reuse
  // this SSO session instead of establishing a fresh one, and issue the
  // code with its own `authTime` rather than `now` — being asked for
  // consent must not itself read as a new authentication.
  reuseSession?: { sessionId: string; authTime: Date };
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

// What a consent decision needs about the client beyond decideConsent's own
// pure inputs: a name to put on the page, and the name<->id mapping a
// consent POST needs to turn a ticked checkbox (a scope name) back into
// what consentRepository persists (a client_scopes id). One dependency
// call bundles all three so the gate and the POST handler each pay for it
// once, not per scope.
export interface ConsentContext {
  clientName: string;
  consentRequired: boolean;
  defaultScopes: string[];
  optionalScopes: string[];
  scopeIdByName: ReadonlyMap<string, string>;
}

export interface ConsentGateDeps {
  consentContext(realmId: string, clientId: string): Promise<ConsentContext>;
  grantedScopeIds(
    realmId: string,
    subjectId: string,
    clientId: string,
  ): Promise<ReadonlySet<string>>;
}

export type ConsentGateOutcome =
  | { kind: 'not_required' }
  | {
      kind: 'ask';
      clientName: string;
      defaultScopes: string[];
      optionalScopes: string[];
      alreadyGranted: string[];
    }
  | { kind: 'refuse' };

// Shared by both doors that can issue a code — the form path, after
// nextRequiredAction clears, and the session-reuse path, once the reused
// subject is known — so a client requiring consent cannot be asked on one
// and waved through the other. Bridges decideConsent's scope-name-only
// world to consentRepository's id-keyed one: `grantedScopeIds` comes back
// as ids, translated to names here before decideConsent ever sees them.
export async function decideConsentGate(
  deps: ConsentGateDeps,
  realmId: string,
  clientId: string,
  subjectId: string,
  requestedScope: string,
  prompt: readonly string[] | undefined,
): Promise<ConsentGateOutcome> {
  const context = await deps.consentContext(realmId, clientId);
  const grantedIds = await deps.grantedScopeIds(realmId, subjectId, clientId);
  const grantedScopes = [...context.scopeIdByName]
    .filter(([, id]) => grantedIds.has(id))
    .map(([name]) => name);

  const decision = decideConsent({
    requestedScopes: requestedScope.split(' ').filter((scope) => scope.length > 0),
    defaultScopes: context.defaultScopes,
    optionalScopes: context.optionalScopes,
    grantedScopes,
    // Every token this server defines is already validated at /authorize
    // (parsePrompt); an unrecognised one could never have reached a parked
    // request, so the cast states an invariant rather than skipping a check.
    prompt: new Set((prompt ?? []) as PromptValue[]),
    consentRequired: context.consentRequired,
  });

  if (decision.kind === 'not_required') return { kind: 'not_required' };
  if (decision.kind === 'refuse') return { kind: 'refuse' };
  return {
    kind: 'ask',
    clientName: context.clientName,
    defaultScopes: decision.defaultScopes,
    optionalScopes: decision.optionalScopes,
    alreadyGranted: decision.alreadyGranted,
  };
}

export interface LoginSubmissionDeps extends ConsentGateDeps {
  findRealm(name: string): Promise<RealmLookup | null>;
  advance(realmId: string, authSessionId: string, input: AdvanceInput): Promise<AdvanceOutcome>;
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
  // Every action this subject still owes, read fresh on every submission —
  // an action completed by a separate request to
  // login-actions/required-action has to be seen the next time this same
  // auth_session_id is resubmitted, not cached from an earlier attempt.
  // That route reads the same set, and refuses to act on an action it does
  // not find there.
  pendingActions(realmId: string, subjectId: string): Promise<readonly RequiredAction[]>;
  // Unbinds the authentication session from the subject who just
  // authenticated and forgets the factors they satisfied — see the
  // id_token_hint branch below, its only caller.
  resetAuthenticationProgress(realmId: string, authSessionId: string): Promise<void>;
  // Consumes the authentication session and, only if that succeeds,
  // establishes the SSO session and issues the authorization code — all in
  // the one transaction this name promises. See index.ts for the wiring
  // that makes it one `withRealm` call rather than three.
  completeLogin(input: CompleteLoginInput): Promise<CompleteLoginOutcome>;
  // The browser's own live session set, resolved from its two cookies —
  // the same authority /authorize and logout resolve through (index.ts).
  // completeAuthorizedLogin reads it to add a login to the set rather than
  // replace it.
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
}

// An authorization error response delivered to the parked request's own
// redirect_uri (OIDC Core §3.1.2.6), carrying `iss` for the same reason the
// success redirect does (RFC 9207 §2). Exported for consent-submission.ts,
// whose 'deny' answer is the same shape of response.
export function errorRedirect(
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

// The tail every path that finishes a login shares, from the resolved
// client onward: consume the authentication session, establish (or reuse)
// the SSO session, issue the code, and assemble the redirect. Used by the
// form path once its gates clear, and by consent-submission.ts on an
// 'allow' — never duplicated, so the two cannot drift on `iss`, `state` or
// the atomic consume. `clientId` is never resolved again here: every
// caller already needed it before reaching this tail.
export async function completeAuthorizedLogin(
  deps: Pick<LoginSubmissionDeps, 'completeLogin' | 'resolveSessions'>,
  realm: {
    id: string;
    name: string;
    ssoSessionMaxSeconds: number;
    ssoSessionIdleSeconds: number;
    rememberMeIdleSeconds: number;
    rememberMeMaxSeconds: number;
  },
  issuerBase: string,
  authSessionId: string,
  pending: PendingRequest,
  clientId: string,
  subjectId: string,
  authenticators: string[],
  // The browser's own `Cookie` header, read by the route and trusted for
  // nothing but resolving its current session set — the same value
  // /authorize and logout resolve through.
  header: string | undefined,
): Promise<LoginSubmissionOutcome> {
  // A session reuse a consent decision promoted (PendingRequest carries
  // its own session's id and authTime): reused, not re-established, so
  // asking for consent cannot itself mint a fresh `auth_time`.
  const reuseSession =
    pending.reuseSessionId !== undefined && pending.reuseAuthTime !== undefined
      ? { sessionId: pending.reuseSessionId, authTime: new Date(pending.reuseAuthTime) }
      : undefined;

  const completed = await deps.completeLogin({
    realmId: realm.id,
    authSessionId,
    subjectId,
    clientId,
    redirectUri: pending.redirectUri,
    scope: pending.scope,
    nonce: pending.nonce,
    codeChallenge: pending.codeChallenge,
    codeChallengeMethod: pending.codeChallengeMethod,
    ssoSessionMaxSeconds: realm.ssoSessionMaxSeconds,
    authenticators,
    ...(reuseSession !== undefined ? { reuseSession } : {}),
  });

  // A second submission of the same auth_session_id — a back-button press,
  // a retried POST — reaches here after everything upstream succeeds again;
  // completeLogin's atomic consume is what stops it from minting a second
  // SSO session and a second code for the same parked request.
  if (completed.kind === 'already_consumed') {
    return { kind: 'unauthenticated' };
  }
  const { sessionId, code } = completed;

  const location = new URL(pending.redirectUri);
  location.searchParams.set('code', code);
  if (pending.state !== null) location.searchParams.set('state', pending.state);
  location.searchParams.set('iss', realmIssuer(issuerBase, realm.name));

  // The browser's other live sessions, joined with this one, split by the
  // cookie each already belongs to (`remembered`) — not by which cookie the
  // request happened to carry it in, so a mismatched cookie self-heals. A
  // reused session keeps whichever list it was already in; a freshly
  // established one is always ephemeral until a login can ask to be
  // remembered.
  const existing = await deps.resolveSessions(
    {
      id: realm.id,
      name: realm.name,
      ssoSessionIdleSeconds: realm.ssoSessionIdleSeconds,
      ssoSessionMaxSeconds: realm.ssoSessionMaxSeconds,
      rememberMeIdleSeconds: realm.rememberMeIdleSeconds,
      rememberMeMaxSeconds: realm.rememberMeMaxSeconds,
    },
    header,
  );
  const survivors = existing.filter((session) => session.id !== sessionId);
  const remembered = existing.find((session) => session.id === sessionId)?.remembered ?? false;
  const bucket = (flag: boolean) =>
    survivors.filter((session) => session.remembered === flag).map((session) => session.id);

  return {
    kind: 'redirect',
    location: location.toString(),
    sessionId,
    ephemeralSessionIds: remembered ? bucket(false) : [...bucket(false), sessionId],
    persistentSessionIds: remembered ? [...bucket(true), sessionId] : bucket(true),
    persistentMaxAgeSeconds: realm.ssoSessionMaxSeconds,
  };
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
  // The browser's `Cookie` header, threaded through to completeAuthorizedLogin
  // — required, not optional: an omitted header resolves to an empty
  // session set and silently drops every other live session from the
  // reply's cookie. A caller with no cookie to give passes `undefined`
  // explicitly.
  header: string | undefined,
): Promise<LoginSubmissionOutcome> {
  // A value that is not shaped like a uuid names no session and never
  // could: folded in here rather than left to the `uuid` comparison, where
  // Postgres raises rather than matching nothing and an unauthenticated
  // caller decides what gets logged as a server fault.
  if (authSessionId === undefined || !isUuid(authSessionId)) {
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
    return {
      kind: 'reject',
      authSessionId,
      ...(result.kind === 'failure' && result.reason === 'already_used'
        ? { reason: 'You have already used that recovery code. Try another one from your list.' }
        : {}),
    };
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
    // The one refusal whose remedy is a *different* person signing in. The
    // attempt is bound to the subject who just authenticated, and every
    // factor they satisfied is recorded against them, so the right End-User
    // could not sign in against this parked request until both are cleared.
    await deps.resetAuthenticationProgress(realm.id, authSessionId);
    return {
      kind: 'error_redirect',
      location: errorRedirect(pending, realmName, issuerBase, 'login_required'),
    };
  }

  // Checked only once the request is known to be answerable for this
  // subject: asking the wrong End-User to complete their own pending
  // action for a request that was always going to end in login_required
  // is the wrong order of operations, even though nothing would leak from
  // it. Nothing is established and nothing is issued until the action is
  // done, and the authentication session is deliberately left unconsumed
  // so the same parked request survives the detour.
  const action = nextRequiredAction(await deps.pendingActions(realm.id, result.subjectId));
  if (action !== null) {
    return { kind: 'required_action', authSessionId, subjectId: result.subjectId, action };
  }

  const clientId = await deps.resolveClientId(realm.id, pending.clientId);
  if (clientId === null) {
    return { kind: 'unauthenticated' };
  }

  // The second gate a fully authenticated subject can still owe: consent.
  // Checked after the required-action gate for the reason that one is
  // checked before completion — a subject who must change their password
  // does that before being asked what to share, and nothing is established
  // or issued until both are done. The authentication session is left
  // unconsumed so the consent POST resumes this same parked request.
  const gate = await decideConsentGate(
    deps,
    realm.id,
    clientId,
    result.subjectId,
    pending.scope,
    pending.prompt,
  );
  if (gate.kind === 'refuse') {
    return {
      kind: 'error_redirect',
      location: errorRedirect(pending, realmName, issuerBase, 'consent_required'),
    };
  }
  if (gate.kind === 'ask') {
    return {
      kind: 'consent',
      authSessionId,
      clientName: gate.clientName,
      defaultScopes: gate.defaultScopes,
      optionalScopes: gate.optionalScopes,
      alreadyGranted: gate.alreadyGranted,
    };
  }

  return completeAuthorizedLogin(
    deps,
    {
      id: realm.id,
      name: realmName,
      ssoSessionMaxSeconds: realm.ssoSessionMaxSeconds,
      ssoSessionIdleSeconds: realm.ssoSessionIdleSeconds,
      rememberMeIdleSeconds: realm.rememberMeIdleSeconds,
      rememberMeMaxSeconds: realm.rememberMeMaxSeconds,
    },
    issuerBase,
    authSessionId,
    pending,
    clientId,
    result.subjectId,
    result.authenticators,
    header,
  );
}
