import { sessionCookieName } from '@odudu/authn-flows';
import { type FastifyInstance } from 'fastify';
import { handleConsentSubmission, type ConsentSubmissionDeps } from '#/usecase/consent-submission';
import { renderAuthorizeErrorPage, renderEmailUnverifiedPage } from '#/view/authorize-html';
import { sendHtml } from '#/view/html-response';
import { issuerBaseFor } from '#/view/issuer';
import {
  sendRequiredActionPage,
  type RequiredActionResponseDeps,
} from '#/view/routes/required-action-response';

// Omits RequiredActionResponseDeps's own `findRealm`: ConsentSubmissionDeps
// already declares one, and TypeScript refuses to extend two interfaces
// whose same-named method signatures are not identical, even when they are
// structurally compatible (RealmLookup is a subtype of the `{ id }` shape
// sendRequiredActionPage actually reads).
export interface ConsentRouteDeps
  extends ConsentSubmissionDeps, Omit<RequiredActionResponseDeps, 'findRealm'> {
  tls: boolean;
}

function firstString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

// @fastify/formbody parses a repeated `scope` checkbox field into an array
// of the ticked values; one ticked box arrives as a bare string, and none
// ticked arrives as undefined — all three are normalised to a list here.
function scopeValues(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

// Deliberately not under /protocol/openid-connect/, for the reason login.ts
// gives: this is Odudu's own UI, not the OIDC wire protocol.
export function registerConsentRoute(app: FastifyInstance, deps: ConsentRouteDeps): void {
  app.post<{
    Params: { realm: string };
    Body: Record<string, string | string[] | undefined>;
  }>('/realms/:realm/login-actions/consent', async (request, reply) => {
    const body = request.body;
    const authSessionId = firstString(body.auth_session_id);

    const outcome = await handleConsentSubmission(
      deps,
      request.params.realm,
      issuerBaseFor(request),
      authSessionId,
      { decision: firstString(body.decision), scopes: scopeValues(body.scope) },
    );

    if (outcome.kind === 'unauthenticated') {
      return sendHtml(
        reply,
        400,
        renderAuthorizeErrorPage(
          'invalid_request',
          'This sign-in attempt is no longer valid. Go back and start again.',
        ),
      );
    }

    // No set-cookie on 'error_redirect': nothing was established to carry
    // in one. A 'redirect' means completeAuthorizedLogin ran establishSession
    // exactly as the form path's own success redirect does, so it gets the
    // same cookie, set the same way (login.ts's own comment has the
    // attributes' reasoning).
    if (outcome.kind === 'error_redirect') {
      return reply.code(302).header('location', outcome.location).send();
    }

    // The same two gates login.ts's own form submission can still owe at
    // this point — nothing is established or issued, so no location header
    // and no cookie either. See consent-submission.ts's module comment on
    // ConsentSubmissionOutcome for why a decision=allow has to clear these
    // too.
    if (outcome.kind === 'unverified') {
      return sendHtml(reply, 200, renderEmailUnverifiedPage(outcome.hasEmail));
    }

    if (outcome.kind === 'required_action') {
      return sendRequiredActionPage(
        reply,
        deps,
        request.params.realm,
        outcome.authSessionId,
        outcome.subjectId,
        outcome.action,
      );
    }

    const cookieName = sessionCookieName(request.params.realm, deps.tls);
    const cookie = [
      `${cookieName}=${outcome.sessionId}`,
      'HttpOnly',
      'SameSite=Lax',
      'Path=/',
      ...(deps.tls ? ['Secure'] : []),
    ].join('; ');

    return reply.code(302).header('set-cookie', cookie).header('location', outcome.location).send();
  });
}
