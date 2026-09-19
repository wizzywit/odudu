import {
  nextRequiredAction,
  type PendingRequest,
  type RequiredAction,
  type SessionRecord,
} from '@odudu/authn-flows';
import { isUuid } from '@odudu/kernel';
import { type RealmLookup } from '#/repository/realm-lookup';
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
      ephemeralSessionIds: readonly string[];
      persistentSessionIds: readonly string[];
      persistentMaxAgeSeconds: number;
    };

export interface ConsentSubmissionDeps {
  findRealm(name: string): Promise<RealmLookup | null>;
  // What handleLoginSubmission's gate already established when it parked
  // this request: who, and with which factors. A session that never
  // finished authenticating, or that has already been consumed, answers
  // null — the same refusal a missing or expired one gets.
  authenticatedSession(
    realmId: string,
    authSessionId: string,
  ): Promise<{ subjectId: string; authenticators: string[] } | null>;
  loadPendingRequest(realmId: string, authSessionId: string): Promise<PendingRequest | null>;
  resolveClientId(realmId: string, oauthClientId: string): Promise<string | null>;
  consentContext(realmId: string, clientId: string): Promise<ConsentContext>;
  // Replaces the client's recorded grant for this subject with exactly the
  // scopes ticked (plus every default, which carries no checkbox) — see
  // consentRepository.record's own comment for why this is a replace, not
  // a merge.
  recordConsent(
    realmId: string,
    subjectId: string,
    clientId: string,
    scopeIds: readonly string[],
  ): Promise<void>;
  completeLogin(input: CompleteLoginInput): Promise<CompleteLoginOutcome>;
  // The same session-set authority completeAuthorizedLogin reads on the
  // form path — see login-submission.ts's LoginSubmissionDeps for the
  // full comment.
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
  // The same two dependencies handleLoginSubmission reads to enforce its own
  // pre-consent gates — see refusedForUnverifiedEmail and nextRequiredAction
  // below, this endpoint's only callers of either.
  checkEmailVerification(
    realmId: string,
    subjectId: string,
  ): Promise<{ verified: boolean; hasEmail: boolean }>;
  pendingActions(realmId: string, subjectId: string): Promise<readonly RequiredAction[]>;
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
  realmName: string,
  issuerBase: string,
  authSessionId: string | undefined,
  answer: ConsentAnswer,
  // The browser's `Cookie` header — required, not optional; see
  // login-submission.ts's identical parameter on handleLoginSubmission for
  // why an omitted one is a silent bug rather than a safe default.
  header: string | undefined,
): Promise<ConsentSubmissionOutcome> {
  if (authSessionId === undefined || !isUuid(authSessionId)) {
    return { kind: 'unauthenticated' };
  }

  const realm = await deps.findRealm(realmName);
  if (!realm?.enabled) {
    return { kind: 'unauthenticated' };
  }

  const authenticated = await deps.authenticatedSession(realm.id, authSessionId);
  if (authenticated === null) {
    return { kind: 'unauthenticated' };
  }
  const { subjectId, authenticators } = authenticated;

  // The first of the two gates handleLoginSubmission clears before it will
  // ever produce a 'consent' outcome — checked here in the same order, for
  // the same reason: a parked request can only reach this endpoint by
  // having been refused past this point once already, and a decision=allow
  // posted straight at it must not skip what the form path never let it
  // skip. See refusedForUnverifiedEmail's own comment for why this sits
  // ahead of everything else.
  const emailRefusal = await refusedForUnverifiedEmail(deps, realm, subjectId);
  if (emailRefusal !== null) {
    return { kind: 'unverified', authSessionId, hasEmail: emailRefusal.hasEmail };
  }

  // The only source of scope, redirect_uri, nonce, state and
  // code_challenge — never the request body, for the same reason
  // handleLoginSubmission never reads them from the form.
  const pending = await deps.loadPendingRequest(realm.id, authSessionId);
  if (pending === null) {
    return { kind: 'unauthenticated' };
  }

  // The second gate handleLoginSubmission clears before 'consent': a
  // required action owed by this subject, checked before the client is even
  // resolved, mirroring where the form path checks it.
  const action = nextRequiredAction(await deps.pendingActions(realm.id, subjectId));
  if (action !== null) {
    return { kind: 'required_action', authSessionId, subjectId, action };
  }

  const clientId = await deps.resolveClientId(realm.id, pending.clientId);
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
      location: errorRedirect(pending, realmName, issuerBase, 'access_denied'),
    };
  }

  const context = await deps.consentContext(realm.id, clientId);
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
  await deps.recordConsent(realm.id, subjectId, clientId, recordedIds);

  // completeAuthorizedLogin's return type covers every LoginSubmissionOutcome
  // member for the form path's sake; from here it can only ever produce
  // 'unauthenticated' (an already-consumed session) or 'redirect'; see the
  // module comment on ConsentSubmissionOutcome.
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
    { ...pending, scope: finalScopes.join(' ') },
    clientId,
    subjectId,
    authenticators,
    header,
  ) as Promise<ConsentSubmissionOutcome>;
}
