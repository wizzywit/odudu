import {
  nextRequiredAction,
  type PendingRequest,
  type PresentedSession,
  type RequiredAction,
  type SessionEntry,
} from '@odudu/authn-flows';
import { type RequestContext } from '@odudu/domain-audit';
import { isUuid } from '@odudu/kernel';
import { type TenantLookup } from '#/repository/tenant-lookup';
import {
  completeAuthorizedLogin,
  errorRedirect,
  refusedForUnverifiedEmail,
  type CompleteLoginInput,
  type CompleteLoginOutcome,
  type ConsentContext,
} from '#/usecase/login-submission';

// completeAuthorizedLogin's own return type covers every LoginSubmissionOutcome
// member because the form path shares it too, but only 'redirect' and
// 'unauthenticated' (an already-consumed session) are reachable from the
// tail call below — this handler's own two gates below produce 'unverified'
// and 'required_action' themselves, and 'consent' cannot recur from a
// session that already answered it.
export type ConsentSubmissionOutcome =
  | { kind: 'unauthenticated' }
  | { kind: 'error_redirect'; location: string }
  // The same two gates handleLoginSubmission enforces before it will ever
  // hand out a 'consent' outcome, enforced again here: the session this
  // request resumes was parked *before* either check could run (both leave
  // the authentication session unconsumed on purpose, so the parked request
  // survives), so a decision=allow posted straight to this endpoint must
  // clear them too, in the same order, or it is a third door around both.
  | { kind: 'unverified'; authSessionId: string; hasEmail: boolean }
  | { kind: 'required_action'; authSessionId: string; subjectId: string; action: RequiredAction }
  | {
      kind: 'redirect';
      location: string;
      sessionId: string;
      ephemeralSessions: readonly SessionEntry[];
      persistentSessions: readonly SessionEntry[];
      persistentMaxAgeSeconds: number;
    };

export interface ConsentSubmissionDeps {
  findTenant(name: string): Promise<TenantLookup | null>;
  // What handleLoginSubmission's gate already established when it parked
  // this request: who, and with which factors. A session that never
  // finished authenticating, or that has already been consumed, answers
  // null — the same refusal a missing or expired one gets.
  authenticatedSession(
    tenantId: string,
    authSessionId: string,
  ): Promise<{ subjectId: string; authenticators: string[] } | null>;
  loadPendingRequest(tenantId: string, authSessionId: string): Promise<PendingRequest | null>;
  resolveClientId(tenantId: string, oauthClientId: string): Promise<string | null>;
  consentContext(tenantId: string, clientId: string): Promise<ConsentContext>;
  // Replaces the client's recorded grant for this subject with exactly the
  // scopes ticked (plus every default, which carries no checkbox) — see
  // consentRepository.record's own comment for why this is a replace, not
  // a merge.
  recordConsent(
    tenantId: string,
    subjectId: string,
    clientId: string,
    scopeIds: readonly string[],
  ): Promise<void>;
  completeLogin(input: CompleteLoginInput): Promise<CompleteLoginOutcome>;
  // The same session-set authority completeAuthorizedLogin reads on the
  // form path — see login-submission.ts's LoginSubmissionDeps for the
  // full comment.
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
  // The same two dependencies handleLoginSubmission reads to enforce its own
  // pre-consent gates — see refusedForUnverifiedEmail and nextRequiredAction
  // below, this endpoint's only callers of either.
  checkEmailVerification(
    tenantId: string,
    subjectId: string,
  ): Promise<{ verified: boolean; hasEmail: boolean }>;
  pendingActions(tenantId: string, subjectId: string): Promise<readonly RequiredAction[]>;
}

// The route's whole answer to "what did the person tick and press" — never
// the request body, which #/view/routes/consent.ts has already reduced to
// this before calling in.
export interface ConsentAnswer {
  decision: string | undefined;
  scopes: readonly string[];
}

// The consent screen's own gate, mirrored on the POST that answers it: an
// auth_session_id that names nothing live is the same refusal
// handleLoginSubmission gives a submission against an unknown or expired
// one — this endpoint has no lesser CSRF defence than the login form does.
export async function handleConsentSubmission(
  deps: ConsentSubmissionDeps,
  tenantName: string,
  issuerBase: string,
  authSessionId: string | undefined,
  answer: ConsentAnswer,
  request: RequestContext,
  // The browser's `Cookie` header — required, not optional; see
  // login-submission.ts's identical parameter on handleLoginSubmission for
  // why an omitted one is a silent bug rather than a safe default.
  header: string | undefined,
): Promise<ConsentSubmissionOutcome> {
  if (authSessionId === undefined || !isUuid(authSessionId)) {
    return { kind: 'unauthenticated' };
  }

  const tenant = await deps.findTenant(tenantName);
  if (!tenant?.enabled) {
    return { kind: 'unauthenticated' };
  }

  // Two of handleLoginSubmission's four pre-consent gates need no mirror
  // here: an `idTokenHintSubject`/`claimsSubject` mismatch there calls
  // `resetAuthenticationProgress`, which nulls `subject_id` and
  // `authenticated_at` — so `authenticatedSession` below already answers
  // null for exactly that attempt, refusing before either of this
  // function's own two checks would run.
  const authenticated = await deps.authenticatedSession(tenant.id, authSessionId);
  if (authenticated === null) {
    return { kind: 'unauthenticated' };
  }
  const { subjectId, authenticators } = authenticated;

  // The other two gates handleLoginSubmission clears before it will ever
  // produce a 'consent' outcome — checked here in the same order, so a
  // decision=allow posted straight at this endpoint cannot skip what the
  // form path never let it skip. See refusedForUnverifiedEmail's own
  // comment for why this sits ahead of everything else.
  const emailRefusal = await refusedForUnverifiedEmail(deps, tenant, subjectId);
  if (emailRefusal !== null) {
    return { kind: 'unverified', authSessionId, hasEmail: emailRefusal.hasEmail };
  }

  // The only source of scope, redirect_uri, nonce, state and
  // code_challenge — never the request body, for the same reason
  // handleLoginSubmission never reads them from the form.
  const pending = await deps.loadPendingRequest(tenant.id, authSessionId);
  if (pending === null) {
    return { kind: 'unauthenticated' };
  }

  // The second gate handleLoginSubmission clears before 'consent': a
  // required action owed by this subject, checked before the client is even
  // resolved, mirroring where the form path checks it.
  const action = nextRequiredAction(await deps.pendingActions(tenant.id, subjectId));
  if (action !== null) {
    return { kind: 'required_action', authSessionId, subjectId, action };
  }

  const clientId = await deps.resolveClientId(tenant.id, pending.clientId);
  if (clientId === null) {
    return { kind: 'unauthenticated' };
  }

  // RFC 6749 §4.1.2.1 names access_denied for exactly this: the
  // resource owner did not grant authorization. The authentication session
  // is left as it is — there is nothing left to retry against it — and
  // nothing is established or issued.
  if (answer.decision !== 'allow') {
    return {
      kind: 'error_redirect',
      location: errorRedirect(pending, tenantName, issuerBase, 'access_denied'),
    };
  }

  const context = await deps.consentContext(tenant.id, clientId);
  const optionalSet = new Set(context.optionalScopes);
  const tickedSet = new Set(answer.scopes);
  const requested = pending.scope.split(' ').filter((scope) => scope.length > 0);

  // Kept if the consent screen never offered a box for it (a default scope,
  // or a requested scope outside the client's declared vocabulary), or if
  // it did and the box came back ticked. A test that only asserted the flow
  // completed would pass even if a declined scope leaked through — this is
  // what makes the redirect (and the token it eventually redeems for) carry
  // only what was actually granted.
  const grantedThisTime = (scope: string): boolean =>
    !optionalSet.has(scope) || tickedSet.has(scope);
  const finalScopes = requested.filter(grantedThisTime);

  // What gets recorded, so the same client does not ask again next time it
  // requests no more than this: the whole answer, not merely what changed,
  // because consentRepository.record replaces the grant rather than
  // merging into it.
  const recordedNames = [...context.defaultScopes, ...context.optionalScopes].filter(
    (scope) => requested.includes(scope) && grantedThisTime(scope),
  );
  const recordedIds = recordedNames
    .map((name) => context.scopeIdByName.get(name))
    .filter((id): id is string => id !== undefined);
  await deps.recordConsent(tenant.id, subjectId, clientId, recordedIds);

  // completeAuthorizedLogin's return type covers every LoginSubmissionOutcome
  // member for the form path's sake; from here it can only ever produce
  // 'unauthenticated' (an already-consumed session) or 'redirect'; see the
  // module comment on ConsentSubmissionOutcome.
  return completeAuthorizedLogin(
    deps,
    {
      id: tenant.id,
      name: tenantName,
      ssoSessionMaxSeconds: tenant.ssoSessionMaxSeconds,
      ssoSessionIdleSeconds: tenant.ssoSessionIdleSeconds,
      rememberMeIdleSeconds: tenant.rememberMeIdleSeconds,
      rememberMeMaxSeconds: tenant.rememberMeMaxSeconds,
      maxSessionsPerBrowser: tenant.maxSessionsPerBrowser,
    },
    issuerBase,
    authSessionId,
    { ...pending, scope: finalScopes.join(' ') },
    clientId,
    subjectId,
    authenticators,
    request,
    header,
    // The only place this choice can still come from: this door reads no
    // `remember_me` field of its own, so whatever handleLoginSubmission's
    // 'consent' branch already gated and parked on the request is what
    // decides — see PendingRequest.rememberMe.
    pending.rememberMe ?? false,
  ) as Promise<ConsentSubmissionOutcome>;
}
