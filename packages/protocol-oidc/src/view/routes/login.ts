import {
  renderPasskeyEnrolmentPage,
  renderRequiredActionPage,
  renderTotpEnrolmentPage,
  sessionCookieName,
  type AuthenticatorResult,
  type PasskeyEnrolmentOffer,
  type TotpEnrolmentOffer,
} from '@odudu/authn-flows';
import { type FastifyInstance } from 'fastify';
import { handleLoginSubmission, type LoginSubmissionDeps } from '#/usecase/login-submission';
import {
  renderAuthorizeErrorPage,
  renderEmailUnverifiedPage,
  renderLoginForm,
} from '#/view/authorize-html';
import { sendHtml } from '#/view/html-response';
import { issuerBaseFor } from '#/view/issuer';

export interface LoginRouteDeps extends LoginSubmissionDeps {
  tls: boolean;
  // What to render on a rejected attempt — asked directly rather than
  // threaded through LoginSubmissionOutcome, so handleLoginSubmission stays
  // as unaware of the flow's requirements as its own tests assume.
  pendingChallenge(realmId: string, authSessionId: string): Promise<AuthenticatorResult>;
  // The secret a configure-totp page shows. Asked for only when that action
  // is the one owed, so a login with nothing pending pays nothing for it.
  beginTotpEnrolment(
    realmName: string,
    realmId: string,
    subjectId: string,
  ): Promise<TotpEnrolmentOffer>;
  // The creation options a configure-passkey page hands the browser, and
  // the challenge it parks on this attempt. Absent when no relying party
  // can be derived, in which case the page that names the action without a
  // form to satisfy it is the honest answer.
  beginPasskeyEnrolment?(
    realmName: string,
    realmId: string,
    subjectId: string,
    authSessionId: string,
  ): Promise<PasskeyEnrolmentOffer>;
}

// pendingChallenge runs in its own transaction, separate from the advance()
// call that produced the reject — a realm whose executions change in that
// window (or a session that expires in it) can make pendingChallenge answer
// something other than a challenge. 'password' is what to fall back to,
// since it is the step every flow this server provisions starts with.
const FALLBACK_FORM = 'password';

// @fastify/formbody parses a repeated field into an array; every field this
// handler reads is meant to carry exactly one value, so a repeat is treated
// as absent rather than silently picking one.
function firstString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

// Deliberately not under /protocol/openid-connect/: that namespace is the
// OIDC wire protocol, and this is Odudu's own login UI, which no
// specification describes and no client library calls.
export function registerLoginRoute(app: FastifyInstance, deps: LoginRouteDeps): void {
  app.post<{
    Params: { realm: string };
    Body: Record<string, string | string[] | undefined>;
  }>('/realms/:realm/login-actions/authenticate', async (request, reply) => {
    const body = request.body;
    const authSessionId = firstString(body.auth_session_id);
    const username = firstString(body.username);
    const password = firstString(body.password);
    const code = firstString(body.code);

    const outcome = await handleLoginSubmission(
      deps,
      request.params.realm,
      issuerBaseFor(request),
      authSessionId,
      {
        ...(username !== undefined ? { username } : {}),
        ...(password !== undefined ? { password } : {}),
        ...(code !== undefined ? { code } : {}),
      },
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

    // No set-cookie: nothing was established to carry in one.
    if (outcome.kind === 'error_redirect') {
      return reply.code(302).header('location', outcome.location).send();
    }

    if (outcome.kind === 'reject') {
      // The realm was already resolved once, inside handleLoginSubmission,
      // to produce this very outcome — resolved again here rather than
      // threading its id back out through LoginSubmissionOutcome, which
      // would leak flow-engine concerns into a type login-submission's own
      // tests assert the shape of.
      const realm = await deps.findRealm(request.params.realm);
      const pending =
        realm === null ? null : await deps.pendingChallenge(realm.id, outcome.authSessionId);
      const form = pending?.kind === 'challenge' ? pending.form : FALLBACK_FORM;
      return sendHtml(
        reply,
        200,
        renderLoginForm(request.params.realm, outcome.authSessionId, form),
      );
    }

    // No location header and no code: the assertion this state exists to
    // make true is that nothing was issued, not that the page says something.
    if (outcome.kind === 'unverified') {
      return sendHtml(reply, 200, renderEmailUnverifiedPage(outcome.hasEmail));
    }

    // Same reasoning as 'unverified': no location header and no code, since
    // nothing was established or issued.
    if (outcome.kind === 'required_action') {
      const realmName = request.params.realm;
      const beginPasskey = deps.beginPasskeyEnrolment?.bind(deps);
      if (outcome.action === 'configure-passkey' && beginPasskey !== undefined) {
        const realm = await deps.findRealm(realmName);
        if (realm !== null) {
          const offer = await beginPasskey(
            realmName,
            realm.id,
            outcome.subjectId,
            outcome.authSessionId,
          );
          return sendHtml(
            reply,
            200,
            renderPasskeyEnrolmentPage(realmName, outcome.authSessionId, offer),
          );
        }
      }
      if (outcome.action !== 'configure-totp') {
        return sendHtml(
          reply,
          200,
          renderRequiredActionPage(realmName, outcome.authSessionId, outcome.action),
        );
      }
      // The realm was already resolved inside handleLoginSubmission, for the
      // same reason the 'reject' branch above resolves it again.
      const realm = await deps.findRealm(realmName);
      if (realm === null) {
        return sendHtml(
          reply,
          200,
          renderRequiredActionPage(realmName, outcome.authSessionId, outcome.action),
        );
      }
      const offer = await deps.beginTotpEnrolment(realmName, realm.id, outcome.subjectId);
      return sendHtml(reply, 200, renderTotpEnrolmentPage(realmName, outcome.authSessionId, offer));
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
