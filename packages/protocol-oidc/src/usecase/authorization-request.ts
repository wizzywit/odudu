import {
  nextRequiredAction,
  type AuthenticatorResult,
  type RequiredAction,
  type SessionRecord,
} from '@odudu/authn-flows';
import { AUDIENCE_UNCHECKED, verifyJwt, type SigningKeyRecord } from '@odudu/crypto';
import { type ClientRecord } from '@odudu/domain-realm';
import { type ClientOidcConfig } from '#/schema/client-oidc-config';
import { type RealmLookup } from '#/repository/realm-lookup';
import {
  validateAuthorizationRequest,
  type AuthorizeOutcome,
} from '#/service/authorize-validation';
import { normalizeAuthorizeQuery } from '#/service/query-normalization';
import { mostRecentlyActive } from '#/service/session-selection';
import {
  decideConsentGate,
  refusedForUnverifiedEmail,
  type ConsentGateDeps,
  type LoginSubmissionDeps,
} from '#/usecase/login-submission';
import { decideReuse, type ResolvedSession } from '#/usecase/session-reuse';

export type AuthorizationRequestOutcome =
  | { kind: 'render'; error: string; description: string }
  | { kind: 'redirect'; redirectUri: string; error: string; state: string | null }
  // `form` names what the rendered login page should ask for first —
  // whatever the realm's flow would offer nobody has submitted anything
  // yet (authn-flows' initialChallenge).
  | { kind: 'started'; authSessionId: string; form: string }
  // Session reuse: a code issued with no page ever rendered and no fresh
  // authentication session started. Carries exactly what the form-POST
  // success redirect carries, because the client cannot tell the two apart.
  | { kind: 'reused'; code: string; redirectUri: string; state: string | null }
  // A live session answers who this is, but consent has not been recorded
  // for everything requested — a client requiring consent must be asked on
  // *every* door that can issue a code, not only the one that renders a
  // login form (see the module comment above completeReuse's caller
  // below). A fresh authentication session is started, already bound and
  // authenticated for the reused subject, so the consent POST has
  // something to resume.
  | {
      kind: 'consent';
      authSessionId: string;
      clientName: string;
      defaultScopes: string[];
      optionalScopes: string[];
      alreadyGranted: string[];
    }
  // The same promotion as 'consent', for the gate handleLoginSubmission
  // checks first: a live session reused for a subject who still owes a
  // required action (an admin-forced password reset, unacknowledged
  // recovery codes, pending enrolment) must not skip it just because no
  // password was typed this time. A fresh authentication session is
  // started, already bound and authenticated for the reused subject, so
  // the required-action route has something to resume.
  | {
      kind: 'required_action';
      authSessionId: string;
      subjectId: string;
      action: RequiredAction;
    };

// What resolving the SSO session cookie against a live row yields — the
// facts decideReuse needs (ResolvedSession), the authenticators that
// session's own login recorded (carried forward rather than re-derived if
// consent promotes this reuse into a full authentication session), and the
// row's own id, needed only afterward, to touch it once reuse is decided.
export type ReusableSession = ResolvedSession & { sessionId: string; authenticators: string[] };

export interface CompleteReuseInput {
  realmId: string;
  sessionId: string;
  subjectId: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  nonce: string | null;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  authTime: Date;
}

export interface ResolvedClient {
  client: ClientRecord | null;
  config: ClientOidcConfig | null;
  // The names of the scopes assigned to this client. Empty for a client that
  // could not be resolved, which is the same answer an unassigned client
  // gives: neither can be granted anything.
  scopes: readonly string[];
}

export interface AuthorizeUsecaseDeps extends ConsentGateDeps {
  findRealm(name: string): Promise<RealmLookup | null>;
  // The realm's own signing keys, which is the whole of "did this server
  // issue that ID Token?" (OIDC Core §3.1.2.2). The same set /jwks
  // publishes and /userinfo verifies against, so a hint minted with a key
  // that has since rotated out of publication is no longer honoured.
  listPublishableKeys(realmId: string): Promise<SigningKeyRecord[]>;
  // Scoped to the resolved realm by the caller composing this dependency
  // (index.ts), the same way listPublishableKeys is for the JWKS route.
  resolveClient(realmId: string, oauthClientId: string): Promise<ResolvedClient>;
  // Shared with the discovery usecase, so a scope this endpoint accepts is
  // one the discovery document advertises and vice versa.
  scopesForRealm(realmId: string): Promise<readonly string[]>;
  startAuthentication(
    realmId: string,
    request: Extract<AuthorizeOutcome, { kind: 'ok' }>['request'],
  ): Promise<{ authSessionId: string }>;
  // What the realm's flow would ask for first, decided before any
  // authentication session exists — also the honest way to notice a flow
  // with no applicable execution at all: OIDC Core §3.1.2.1's `prompt=login`
  // MUST, "an error is returned if reauthentication cannot be performed".
  initialChallenge(realmId: string): Promise<AuthenticatorResult>;
  // The browser's session cookies, resolved to their live rows (never
  // trusted for anything but that lookup) — sessionRepository(tx).liveByIds
  // scoped to the realm's own idle window. decideReuse decides over one
  // session, while a browser may hold several; handleAuthorizationRequest
  // picks the most recently active of the set resolved here.
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
  // The same gate handleLoginSubmission enforces, shared so a cookie-borne
  // login cannot complete for a subject a password login would refuse.
  checkEmailVerification: LoginSubmissionDeps['checkEmailVerification'];
  // The same required-action gate handleLoginSubmission enforces, checked
  // here for the reason checkEmailVerification is: a live cookie must not
  // buy a subject out of an action a password login would still owe.
  pendingActions: LoginSubmissionDeps['pendingActions'];
  // Touches the reused session and issues the code atomically — the same
  // issueAuthorizationCode the form path uses, wrapped with the touch in
  // one transaction the way completeLogin wraps its own two writes.
  completeReuse(input: CompleteReuseInput): Promise<{ code: string }>;
  // Starts a fresh authentication session already bound and authenticated
  // for `subjectId`, with `authenticators` as its satisfied set — the
  // reuse path's way of giving a consent decision something to park the
  // request on and resume, without a single factor actually running.
  markAuthenticated(
    realmId: string,
    authSessionId: string,
    subjectId: string,
    authenticators: readonly string[],
  ): Promise<void>;
  now(): Date;
}

// decideReuse decides over one session, while a browser may hold several —
// mostRecentlyActive (#/service/session-selection) is what stands in until
// it is widened to decide over the resolved set itself.
function toReusableSession(latest: SessionRecord | null): ReusableSession | null {
  if (latest === null) return null;
  return {
    sessionId: latest.id,
    subjectId: latest.subjectId,
    authTime: latest.createdAt,
    authenticators: latest.authenticators,
  };
}

// An unknown or disabled realm is indistinguishable from an unknown or
// disabled client for the same reason discovery and JWKS already treat them
// that way: there is no client to trust a redirect_uri against, so this
// renders exactly like the client half of the §4.1.2.1 boundary rather than
// inventing a second error path.
export async function handleAuthorizationRequest(
  deps: AuthorizeUsecaseDeps,
  realmName: string,
  rawParams: unknown,
  // This realm's issuer identifier, as the discovery document states it: the
  // `iss` an id_token_hint has to carry to have come from here.
  issuer: string,
  // The browser's raw `Cookie` header, read by the route and trusted for
  // nothing but the lookup resolveSessions performs with it — no claim in
  // it, no subject id from it.
  header: string | undefined,
): Promise<AuthorizationRequestOutcome> {
  const normalized = normalizeAuthorizeQuery(rawParams);
  if (normalized.kind === 'render') return normalized;
  const { params, repeatedKey } = normalized;

  const realm = await deps.findRealm(realmName);
  const noScopes: ReadonlySet<string> = new Set();
  if (!realm?.enabled) {
    const outcome = validateAuthorizationRequest(
      params,
      null,
      null,
      noScopes,
      noScopes,
      repeatedKey,
    );
    if (outcome.kind === 'ok') {
      throw new Error(
        'unreachable: validateAuthorizationRequest cannot succeed with a null client',
      );
    }
    return outcome;
  }

  const oauthClientId = params.client_id;
  const resolved: ResolvedClient =
    oauthClientId === undefined
      ? { client: null, config: null, scopes: [] }
      : await deps.resolveClient(realm.id, oauthClientId);

  const outcome = validateAuthorizationRequest(
    params,
    resolved.client,
    resolved.config,
    new Set(await deps.scopesForRealm(realm.id)),
    new Set(resolved.scopes),
    repeatedKey,
  );
  if (outcome.kind !== 'ok') return outcome;

  // Below the §4.1.2.1 boundary: redirect_uri has been matched against the
  // client's registrations, so everything from here reports by redirecting
  // (OIDC Core §3.1.2.6).
  const { request } = outcome;
  const reject = (error: string): AuthorizationRequestOutcome => ({
    kind: 'redirect',
    redirectUri: request.redirectUri,
    error,
    state: request.state,
  });

  let hintSubject: string | null = null;
  if (outcome.idTokenHint !== null) {
    const hint = await subjectOfIdTokenHint(deps, realm.id, issuer, outcome.idTokenHint);
    if (hint === null) return reject('invalid_request');
    hintSubject = hint.subject;
  }

  // OIDC Core §3.1.2.1/§3.1.2.3/§15.1: whether this request can be answered
  // from the End-User's existing SSO session, has to start a fresh
  // authentication, or — under `prompt=none` — must be refused because it
  // would otherwise do one of those. The two are decided together rather
  // than in sequence (docs/protocols/oidc-core.md's reading note has why).
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
  const resolvedSession = toReusableSession(mostRecentlyActive(sessions));
  const decision = decideReuse({
    session: resolvedSession,
    prompts: outcome.prompts,
    maxAge: outcome.maxAge,
    now: deps.now(),
  });

  if (decision.kind === 'refuse') return reject(decision.error);

  if (decision.kind === 'reuse') {
    if (resolvedSession === null) {
      throw new Error('unreachable: decideReuse reused with no resolved session');
    }
    if (resolved.client === null) {
      throw new Error('unreachable: validateAuthorizationRequest succeeded with a null client');
    }

    // The same rule the login form enforces once somebody actually signs
    // in: the End-User a hint names is not the one who is about to be
    // reused into this response.
    if (hintSubject !== null && hintSubject !== decision.subjectId) {
      return reject('login_required');
    }

    // The second door into the same decision handleLoginSubmission's
    // password path guards — an unverified subject that happens to hold a
    // live cookie must not sign in for free.
    const refusal = await refusedForUnverifiedEmail(
      deps,
      { id: realm.id, verifyEmail: realm.verifyEmail },
      decision.subjectId,
    );
    if (refusal !== null) return reject('login_required');

    // Starts a fresh authentication session already bound and authenticated
    // for the reused subject, and parks the request on it with the reuse
    // promotion `completeAuthorizedLogin` reads — the one mechanism both
    // the required-action and the consent gate below use to give the
    // subject something to resume without a single factor actually
    // running again.
    const promoteToParkedRequest = async (): Promise<string> => {
      const { authSessionId } = await deps.startAuthentication(realm.id, {
        ...request,
        prompt: [...outcome.prompts],
        ...(hintSubject !== null ? { idTokenHintSubject: hintSubject } : {}),
        reuseSessionId: resolvedSession.sessionId,
        reuseAuthTime: resolvedSession.authTime.toISOString(),
      });
      await deps.markAuthenticated(
        realm.id,
        authSessionId,
        decision.subjectId,
        resolvedSession.authenticators,
      );
      return authSessionId;
    };

    // The same required-action gate handleLoginSubmission's form path
    // enforces right after the email check and before consent: a live
    // cookie must not buy a subject out of an action a password login
    // would still owe (an admin-forced reset, unacknowledged recovery
    // codes, pending enrolment).
    const action = nextRequiredAction(await deps.pendingActions(realm.id, decision.subjectId));
    if (action !== null) {
      // §3.1.2.1: `prompt=none` MUST NOT display any UI, required-action
      // page included — refused before a session is parked, the same as
      // the email-verification gate above.
      if (outcome.prompts.has('none')) return reject('login_required');
      const authSessionId = await promoteToParkedRequest();
      return { kind: 'required_action', authSessionId, subjectId: decision.subjectId, action };
    }

    // The gate handleLoginSubmission's form path enforces right before it
    // would otherwise complete: a client requiring consent must be asked on
    // *this* door too, or a `consent_required` client is asked exactly
    // once, ever — the first time it is registered, and never again from a
    // reused session, since this is the only door a reuse ever passes
    // through with no form and no gate of its own.
    const gate = await decideConsentGate(
      deps,
      realm.id,
      resolved.client.id,
      decision.subjectId,
      request.scope,
      [...outcome.prompts],
    );
    if (gate.kind === 'refuse') return reject('consent_required');
    if (gate.kind === 'ask') {
      const authSessionId = await promoteToParkedRequest();
      return {
        kind: 'consent',
        authSessionId,
        clientName: gate.clientName,
        defaultScopes: gate.defaultScopes,
        optionalScopes: gate.optionalScopes,
        alreadyGranted: gate.alreadyGranted,
      };
    }

    const { code } = await deps.completeReuse({
      realmId: realm.id,
      sessionId: resolvedSession.sessionId,
      subjectId: decision.subjectId,
      clientId: resolved.client.id,
      redirectUri: request.redirectUri,
      scope: request.scope,
      nonce: request.nonce,
      codeChallenge: request.codeChallenge,
      codeChallengeMethod: request.codeChallengeMethod,
      authTime: decision.authTime,
    });
    return { kind: 'reused', code, redirectUri: request.redirectUri, state: request.state };
  }

  // A realm whose flow has no applicable execution at all cannot
  // authenticate anyone — the state OIDC Core §3.1.2.1 means by
  // "reauthentication cannot be performed" under `prompt=login`. Checked
  // before a session is started: nothing is parked and nothing rendered
  // for a login that could never succeed.
  const initial = await deps.initialChallenge(realm.id);
  if (initial.kind !== 'challenge') {
    if (initial.kind === 'success') {
      throw new Error('unreachable: initialChallenge succeeded with no input submitted');
    }
    return reject('login_required');
  }

  const { authSessionId } = await deps.startAuthentication(realm.id, {
    ...request,
    // `prompt=login` needs nothing parked: authentication is unconditional
    // (§3.1.2.3's reauthentication is what this server does for every
    // request). The hint is a different matter — whether the End-User who
    // signs in is the one it identifies can only be judged once they have,
    // which is the login submission, so it travels with the parked request.
    ...(hintSubject !== null ? { idTokenHintSubject: hintSubject } : {}),
    // Carried forward so handleLoginSubmission's own consent gate, once
    // this login completes, still sees `prompt=consent` the way it would
    // have at the moment this request first arrived.
    prompt: [...outcome.prompts],
  });
  return { kind: 'started', authSessionId, form: initial.form };
}

export interface IdTokenHintClaims {
  subject: string;
  // Back-Channel Logout §2.1's session identifier, when the hint carries
  // one — absent from a hint minted before this phase started emitting it.
  // Read by `#/usecase/logout.ts` to compare against the *session*, not
  // just the subject (see decideLogout).
  sid: string | null;
  // The clients this hint was issued to, as its `aud` names them. Not an
  // audience this server has to be in — nothing here checks it against a
  // principal — but the value RP-Initiated Logout §2 has the OP compare a
  // `client_id` parameter against.
  audiences: readonly string[];
}

function audiencesOf(claim: unknown): readonly string[] {
  if (typeof claim === 'string') return [claim];
  if (!Array.isArray(claim)) return [];
  return claim.filter((value): value is string => typeof value === 'string');
}

// OIDC Core §3.1.2.2: "the OP MUST validate that it was the issuer of the ID
// Token" — a signature made by one of this realm's keys, over a payload whose
// `iss` is this realm. Returns the claims it carries, or null for a hint
// this server cannot recognise as its own. `exp` is enforced by verifyJwt,
// so a hint past its expiry is refused rather than accepted as §3.1.2.2's
// SHOULD allows (see the reading note in docs/protocols/oidc-core.md).
// Exported for `#/usecase/logout.ts`, which validates its own hint the same
// way rather than a second, looser check.
export async function subjectOfIdTokenHint(
  deps: Pick<AuthorizeUsecaseDeps, 'listPublishableKeys'>,
  realmId: string,
  issuer: string,
  hint: string,
): Promise<IdTokenHintClaims | null> {
  const keys = await deps.listPublishableKeys(realmId);
  try {
    // An ID token's `aud` is the client it was issued to, so the OP reading
    // one back as a hint is not the principal RFC 7519 §4.1.3 addresses and
    // has no audience of its own to match. §3.1.2.2 asks only that the OP
    // was its issuer, which `issuer` and the realm's own keys settle.
    const payload = await verifyJwt(hint, {
      keys,
      issuer,
      audience: AUDIENCE_UNCHECKED,
      // An ID Token has no `typ` of its own — OIDC Core §2 defines none and
      // the ones /token issues carry none — so the honest demand is not
      // "must be an ID Token" but "must not be an access token", which RFC
      // 9068 §2.1's `at+jwt` names exactly. /userinfo makes the mirror image
      // of this check of the token presented to it.
      typ: { refused: 'at+jwt' },
    });
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    return {
      subject: payload.sub,
      sid: typeof payload.sid === 'string' && payload.sid.length > 0 ? payload.sid : null,
      audiences: audiencesOf(payload.aud),
    };
  } catch {
    return null;
  }
}
