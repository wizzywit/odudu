import { type PendingRequest } from '@odudu/authn-flows';
import { isUuid } from '@odudu/kernel';
import { type RealmLookup } from '#/repository/realm-lookup';
import {
  completeAuthorizedLogin,
  errorRedirect,
  type CompleteLoginInput,
  type CompleteLoginOutcome,
  type ConsentContext,
} from '#/usecase/login-submission';

// completeAuthorizedLogin's own return type covers every LoginSubmissionOutcome
// member (required_action, unverified, consent...) because the form path
// shares it too, but none of those are reachable here: the session this
// function resumes has already cleared every gate that could produce them.
// Only the three this handler's own logic can also produce are named.
export type ConsentSubmissionOutcome =
  | { kind: 'unauthenticated' }
  | { kind: 'error_redirect'; location: string }
  | { kind: 'redirect'; location: string; sessionId: string };

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

  // The only source of scope, redirect_uri, nonce, state and
  // code_challenge — never the request body, for the same reason
  // handleLoginSubmission never reads them from the form.
  const pending = await deps.loadPendingRequest(realm.id, authSessionId);
  if (pending === null) {
    return { kind: 'unauthenticated' };
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
    { id: realm.id, name: realmName, ssoSessionMaxSeconds: realm.ssoSessionMaxSeconds },
    issuerBase,
    authSessionId,
    { ...pending, scope: finalScopes.join(' ') },
    subjectId,
    authenticators,
  ) as Promise<ConsentSubmissionOutcome>;
}
