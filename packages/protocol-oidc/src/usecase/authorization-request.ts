import {
  nextRequiredAction,
  type AuthenticatorResult,
  type PendingRequest,
  type RequiredAction,
  type SessionRecord,
} from '@odudu/authn-flows';
import { verifyJwt, TYP_ABSENT, type ExpectedAudience, type SigningKeyRecord } from '@odudu/crypto';
import { type ClientRecord } from '@odudu/domain-realm';
import { isUuid } from '@odudu/kernel';
import { type ClientOidcConfig } from '#/schema/client-oidc-config';
import { type RealmLookup } from '#/repository/realm-lookup';
import {
  validateAuthorizationRequest,
  type AuthorizeOutcome,
} from '#/service/authorize-validation';
import { normalizeAuthorizeQuery } from '#/service/query-normalization';
import { parseResource } from '#/service/resource-indicator';
import {
  decideConsentGate,
  refusedForUnverifiedEmail,
  type ConsentGateDeps,
  type LoginSubmissionDeps,
} from '#/usecase/login-submission';
import { decideReuse, withinMaxAge, type ResolvedSession } from '#/usecase/session-reuse';

export type AuthorizationRequestOutcome =
  | { kind: 'render'; error: string; description: string }
  | { kind: 'redirect'; redirectUri: string; error: string; state: string | null }
  // `form` names what the rendered login page should ask for first —
  // whatever the realm's flow would offer nobody has submitted anything
  // yet (authn-flows' initialChallenge).
  | { kind: 'started'; authSessionId: string; form: string; rememberMeAllowed: boolean }
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
    }
  // The browser's cookies resolve to more than one live session, or the
  // client asked with prompt=select_account (OIDC Core §3.1.2.1): neither
  // is answerable without asking which account, so a fresh authentication
  // session is parked — unauthenticated, unlike the reuse promotions above,
  // because nobody has been identified yet — for the chooser's POST to
  // resume once one is.
  | { kind: 'select'; authSessionId: string; accounts: readonly SelectAccountCandidate[] };

export interface SelectAccountCandidate {
  sessionId: string;
  displayName: string;
}

// What resolving the SSO session cookie against a live row yields — the
// facts decideReuse needs (ResolvedSession) plus the authenticators that
// session's own login recorded, carried forward rather than re-derived if
// consent promotes this reuse into a full authentication session.
export type ReusableSession = ResolvedSession & { authenticators: string[] };

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
  // The audience resolved at /authorize (parseResource against the
  // client's registered list) — stored on the code so /token derives `aud`
  // from what was approved rather than re-deriving it.
  resource: readonly string[];
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
  // Reads back the request a 'select' outcome parked — the chooser's POST
  // has no query parameters of its own, so this is its only source of
  // scope, redirect_uri, nonce, state, code_challenge and max_age. Unlike
  // consent-submission.ts's own loadPendingRequest call, this session was
  // never bound to a subject, so it carries its own liveness check
  // (expired or already consumed answers null) rather than relying on
  // authenticatedSession's, which this session could never pass.
  loadPendingRequest(realmId: string, authSessionId: string): Promise<PendingRequest | null>;
  // What the realm's flow would ask for first, decided before any
  // authentication session exists — also the honest way to notice a flow
  // with no applicable execution at all: OIDC Core §3.1.2.1's `prompt=login`
  // MUST, "an error is returned if reauthentication cannot be performed".
  initialChallenge(realmId: string): Promise<AuthenticatorResult>;
  // The browser's session cookies, resolved to their live rows (never
  // trusted for anything but that lookup) — sessionRepository(tx).liveByIds
  // scoped to the realm's own idle window. decideReuse decides over the
  // whole set resolved here, which may belong to more than one subject.
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
  // The account chooser's label for each candidate session:
  // preferred_username falling back to username — never email, a recovery
  // identifier this page can render on a shared device. A subject with no
  // row (impossible for a live session's own subject, but not a type this
  // signature can rule out) is left off the returned map, and the caller
  // falls back to the subject id itself.
  accountDisplayNames(
    realmId: string,
    subjectIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
  now(): Date;
}

// Several live sessions for the same subject are one account, not several
// choices — the chooser shows the newest by authTime and drops the rest.
// The others stay live; this is a rendering decision, not a logout one.
function newestPerSubject(candidates: readonly ResolvedSession[]): readonly ResolvedSession[] {
  const newestBySubject = new Map<string, ResolvedSession>();
  for (const candidate of candidates) {
    const current = newestBySubject.get(candidate.subjectId);
    if (current === undefined || candidate.authTime > current.authTime) {
      newestBySubject.set(candidate.subjectId, candidate);
    }
  }
  return candidates.filter((candidate) => newestBySubject.get(candidate.subjectId) === candidate);
}

function toReusableSession(session: SessionRecord): ReusableSession {
  return {
    id: session.id,
    subjectId: session.subjectId,
    authTime: session.createdAt,
    authenticators: session.authenticators,
  };
}

// normalizeAuthorizeQuery folds every repeated key but `resource` down to a
// single string, which is right for a parameter this server refuses to see
// twice but wrong for one whose whole rule is "reject two values" — so
// `resource` is read from the raw query Fastify handed the route, not from
// the normalized params, the same shape parseResource is typed against.
function resourceParam(rawParams: unknown): string | string[] | undefined {
  if (typeof rawParams !== 'object' || rawParams === null || Array.isArray(rawParams)) {
    return undefined;
  }
  const raw = (rawParams as Record<string, unknown>).resource;
  const sent = Array.isArray(raw) ? raw : [raw];
  // RFC 6749 §3.1: an empty value is an omitted parameter —
  // `parameterValue`'s own rule (query-normalization.ts), restated here
  // because `resource` reads the raw query directly. Without this,
  // `?resource=` alone refuses the request, and `resource=<uri>&resource=`
  // reads as two values instead of one. Unlike `parameterValue`, an
  // unreadable value is dropped, not counted towards a repeat — Fastify's
  // default parser yields only strings here, so the two never diverge on
  // a value either could actually see.
  const present = sent.filter(
    (entry): entry is string => typeof entry === 'string' && entry !== '',
  );
  return present.length > 1 ? present : present[0];
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

  // RFC 8707 §2: resolved against the client's registered audience list
  // before anything else below the boundary, so a request naming a target
  // it may not use is refused before a session is ever touched. A client
  // with no registered audience (every client in this repository, today)
  // still succeeds with an empty resolved audience — see parseResource.
  const resourceOutcome = parseResource(resourceParam(rawParams), resolved.config?.audiences ?? []);
  if (resourceOutcome.kind === 'invalid_target') return reject('invalid_target');
  const audience = resourceOutcome.audience;

  let hintSubject: string | null = null;
  if (outcome.idTokenHint !== null) {
    // Unlike `/logout`, this door has a principal to check the hint's `aud`
    // against: the client making this very request. A hint minted for
    // another client is refused here even though its signature and issuer
    // are this realm's own.
    const hint = await subjectOfIdTokenHint(
      deps,
      realm.id,
      issuer,
      outcome.idTokenHint,
      request.clientId,
    );
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
  const resolvedSessions = sessions.map(toReusableSession);
  // A hint names one subject, so only that subject's sessions are reusable
  // or offered by the chooser here — this is what lets a hinted subject
  // reuse a live session instead of facing a chooser for other subjects on
  // the same browser, and what makes prompt=none answer from it rather
  // than account_selection_required. The chooser POST's own membership
  // check (handleSelectAccountSubmission) is a separate, later question.
  const candidateSessions =
    hintSubject === null
      ? resolvedSessions
      : resolvedSessions.filter((session) => session.subjectId === hintSubject);
  const decision = decideReuse({
    sessions: candidateSessions,
    prompts: outcome.prompts,
    maxAge: outcome.maxAge,
    now: deps.now(),
  });

  if (decision.kind === 'refuse') return reject(decision.error);

  if (decision.kind === 'reuse') {
    const resolvedSession = resolvedSessions.find((s) => s.id === decision.sessionId);
    if (resolvedSession === undefined) {
      throw new Error('unreachable: decideReuse reused a session outside the resolved set');
    }
    if (resolved.client === null) {
      throw new Error('unreachable: validateAuthorizationRequest succeeded with a null client');
    }

    // Invariant, not a live check: candidateSessions above already excluded
    // every session but the hinted subject's own, so decideReuse could not
    // have reused anybody else. A hint mismatch is refused by falling
    // through to a fresh authentication instead (the 'authenticate' branch
    // below), the same door handleLoginSubmission's own hintSubject check
    // guards once somebody actually signs in there.
    if (hintSubject !== null && hintSubject !== decision.subjectId) {
      throw new Error('unreachable: decideReuse reused a session the hint filter excluded');
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
        reuseSessionId: resolvedSession.id,
        reuseAuthTime: resolvedSession.authTime.toISOString(),
        resource: [...audience],
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
      sessionId: resolvedSession.id,
      subjectId: decision.subjectId,
      clientId: resolved.client.id,
      redirectUri: request.redirectUri,
      scope: request.scope,
      nonce: request.nonce,
      codeChallenge: request.codeChallenge,
      codeChallengeMethod: request.codeChallengeMethod,
      authTime: decision.authTime,
      resource: audience,
    });
    return { kind: 'reused', code, redirectUri: request.redirectUri, state: request.state };
  }

  if (decision.kind === 'select') {
    // Parked unauthenticated — no markAuthenticated call, unlike
    // promoteToParkedRequest above, because nobody has been identified yet.
    // handleSelectAccountSubmission binds the session once a choice is
    // posted back and membership against the browser's own cookies is
    // proven.
    const { authSessionId } = await deps.startAuthentication(realm.id, {
      ...request,
      prompt: [...outcome.prompts],
      ...(hintSubject !== null ? { idTokenHintSubject: hintSubject } : {}),
      // Re-checked against whichever session is posted back — see
      // handleSelectAccountSubmission's own withinMaxAge call.
      ...(outcome.maxAge !== null ? { maxAge: outcome.maxAge } : {}),
      resource: [...audience],
    });
    const rendered = newestPerSubject(decision.candidates);
    const names = await deps.accountDisplayNames(
      realm.id,
      rendered.map((candidate) => candidate.subjectId),
    );
    return {
      kind: 'select',
      authSessionId,
      accounts: rendered.map((candidate) => ({
        sessionId: candidate.id,
        displayName: names.get(candidate.subjectId) ?? candidate.subjectId,
      })),
    };
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
    resource: [...audience],
  });
  return {
    kind: 'started',
    authSessionId,
    form: initial.form,
    rememberMeAllowed: realm.rememberMeAllowed,
  };
}

export type SelectAccountOutcome =
  | AuthorizationRequestOutcome
  | { kind: 'unauthenticated' }
  // The posted session_id names no member of the set this browser's own
  // cookies resolve to — refused rather than honoured, because that is the
  // whole of this endpoint's defence against completing as somebody else's
  // account (see the module comment on ReusableSession and decideReuse's
  // own module comment for the property this enforces).
  | { kind: 'invalid_selection' };

export interface SelectAccountAnswer {
  sessionId: string | undefined;
  useOther: boolean;
}

// The chooser's POST: resolves the browser's own live sessions again — the
// posted session_id is a claim, and only membership in that fresh set
// authorises it — then continues exactly the tail handleAuthorizationRequest
// runs for an ungated 'reuse' decision, with the chosen session standing in
// for the one decideReuse would have picked unassisted.
export async function handleSelectAccountSubmission(
  deps: AuthorizeUsecaseDeps,
  realmName: string,
  authSessionId: string | undefined,
  answer: SelectAccountAnswer,
  header: string | undefined,
): Promise<SelectAccountOutcome> {
  if (authSessionId === undefined || !isUuid(authSessionId)) {
    return { kind: 'unauthenticated' };
  }

  const realm = await deps.findRealm(realmName);
  if (!realm?.enabled) {
    return { kind: 'unauthenticated' };
  }

  const pending: PendingRequest | null = await deps.loadPendingRequest(realm.id, authSessionId);
  if (pending === null) {
    return { kind: 'unauthenticated' };
  }

  if (answer.useOther) {
    const initial = await deps.initialChallenge(realm.id);
    if (initial.kind !== 'challenge') {
      if (initial.kind === 'success') {
        throw new Error('unreachable: initialChallenge succeeded with no input submitted');
      }
      return {
        kind: 'redirect',
        redirectUri: pending.redirectUri,
        error: 'login_required',
        state: pending.state,
      };
    }
    // The same parked authentication session, not a fresh one: nobody was
    // ever bound to it, so the ordinary login form resumes it exactly as if
    // it had rendered that form to begin with.
    return {
      kind: 'started',
      authSessionId,
      form: initial.form,
      rememberMeAllowed: realm.rememberMeAllowed,
    };
  }

  const realmShape = {
    id: realm.id,
    name: realmName,
    ssoSessionIdleSeconds: realm.ssoSessionIdleSeconds,
    ssoSessionMaxSeconds: realm.ssoSessionMaxSeconds,
    rememberMeIdleSeconds: realm.rememberMeIdleSeconds,
    rememberMeMaxSeconds: realm.rememberMeMaxSeconds,
  };
  const sessions = await deps.resolveSessions(realmShape, header);
  const chosen = sessions.find((session) => session.id === answer.sessionId);
  // Membership alone is not enough: decideReuse's own candidate filter
  // (session-reuse.ts's withinMaxAge) already excluded anything older than
  // the parked request's own max_age when the chooser rendered, and a
  // session excluded from that page is not a valid choice merely because
  // it is still live and still this browser's.
  if (chosen === undefined || !withinMaxAge(chosen.createdAt, pending.maxAge ?? null, deps.now())) {
    return { kind: 'invalid_selection' };
  }

  const resolvedClient = await deps.resolveClient(realm.id, pending.clientId);
  if (resolvedClient.client === null) {
    return { kind: 'unauthenticated' };
  }
  const client = resolvedClient.client;

  const reject = (error: string): SelectAccountOutcome => ({
    kind: 'redirect',
    redirectUri: pending.redirectUri,
    error,
    state: pending.state,
  });

  // The same rule the reuse tail enforces once a candidate is settled: the
  // End-User a hint names is not whoever the browser happens to have picked.
  if (pending.idTokenHintSubject !== undefined && pending.idTokenHintSubject !== chosen.subjectId) {
    return reject('login_required');
  }

  const refusal = await refusedForUnverifiedEmail(
    deps,
    { id: realm.id, verifyEmail: realm.verifyEmail },
    chosen.subjectId,
  );
  if (refusal !== null) return reject('login_required');

  const action = nextRequiredAction(await deps.pendingActions(realm.id, chosen.subjectId));
  if (action !== null) {
    await deps.markAuthenticated(realm.id, authSessionId, chosen.subjectId, chosen.authenticators);
    return { kind: 'required_action', authSessionId, subjectId: chosen.subjectId, action };
  }

  const gate = await decideConsentGate(
    deps,
    realm.id,
    client.id,
    chosen.subjectId,
    pending.scope,
    pending.prompt,
  );
  if (gate.kind === 'refuse') return reject('consent_required');
  if (gate.kind === 'ask') {
    await deps.markAuthenticated(realm.id, authSessionId, chosen.subjectId, chosen.authenticators);
    return {
      kind: 'consent',
      authSessionId,
      clientName: gate.clientName,
      defaultScopes: gate.defaultScopes,
      optionalScopes: gate.optionalScopes,
      alreadyGranted: gate.alreadyGranted,
    };
  }

  // Deliberately not consumed: a live SSO cookie can drive completeReuse
  // through the ordinary GET as many times as a client re-asks, and a
  // chooser selection is the same reuse with the candidate picked rather
  // than inferred — repeatable for the same reason, gated by pendingSession's
  // own expiry check above rather than by single use.
  const { code } = await deps.completeReuse({
    realmId: realm.id,
    sessionId: chosen.id,
    subjectId: chosen.subjectId,
    clientId: client.id,
    redirectUri: pending.redirectUri,
    scope: pending.scope,
    nonce: pending.nonce,
    codeChallenge: pending.codeChallenge,
    codeChallengeMethod: pending.codeChallengeMethod,
    authTime: chosen.createdAt,
    // Parked on PendingRequest by the /authorize GET that started this
    // journey — resolved once, against the query it actually carried, not
    // re-derived here where no query parameters survive.
    resource: pending.resource ?? [],
  });
  return { kind: 'reused', code, redirectUri: pending.redirectUri, state: pending.state };
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
// `iss` is this realm; `exp` is enforced by verifyJwt too. Returns the
// claims it carries, or null for a hint this server cannot recognise as its
// own. `audience` is a parameter, not a constant — callers differ on
// whether they check it; see docs/protocols/oidc-core.md's reading note.
// Exported for `#/usecase/logout.ts`, which shares this check.
export async function subjectOfIdTokenHint(
  deps: Pick<AuthorizeUsecaseDeps, 'listPublishableKeys'>,
  realmId: string,
  issuer: string,
  hint: string,
  audience: ExpectedAudience,
): Promise<IdTokenHintClaims | null> {
  const keys = await deps.listPublishableKeys(realmId);
  try {
    const payload = await verifyJwt(hint, {
      keys,
      issuer,
      audience,
      // An ID Token has no `typ` of its own (OIDC Core §2), so a hint is
      // read as one only when its header carries none at all —
      // `{refused: 'at+jwt'}` once denylisted only the one confusion this
      // server had already made once; `TYP_ABSENT` closes the shape rather
      // than the instance (docs/protocols/oidc-core.md's reading note).
      typ: TYP_ABSENT,
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
