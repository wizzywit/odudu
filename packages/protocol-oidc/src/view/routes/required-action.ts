import {
  renderPasskeyEnrolmentPage,
  renderRecoveryCodesPage,
  renderRequiredActionPage,
  renderTotpEnrolmentPage,
  type AuthenticatorResult,
  type PasskeyEnrolmentOffer,
  type RecoveryCodesOffer,
  type TotpEnrolmentOffer,
} from '@odudu/authn-flows';
import { type FastifyInstance } from 'fastify';
import {
  handleRequiredActionSubmission,
  type RequiredActionSubmissionDeps,
} from '#/usecase/required-action-submission';
import { renderAuthorizeErrorPage, renderLoginForm } from '#/view/authorize-html';
import { sendHtml } from '#/view/html-response';

export interface RequiredActionRouteDeps extends RequiredActionSubmissionDeps {
  // Whether this deployment can offer a passkey login at all — see
  // renderLoginForm in #/view/authorize-html.
  passkeyLogin?: boolean;
  // A fresh secret and the otpauth:// URI for it, for the subject the
  // authentication session is bound to.
  beginTotpEnrolment(
    realmName: string,
    realmId: string,
    subjectId: string,
  ): Promise<TotpEnrolmentOffer>;
  // Fresh creation options, and a fresh challenge parked on the attempt, for
  // a retry after a refused ceremony. Absent on a deployment with no
  // relying party to name.
  beginPasskeyEnrolment?(
    realmName: string,
    realmId: string,
    subjectId: string,
    authSessionId: string,
  ): Promise<PasskeyEnrolmentOffer>;
  // Ten fresh codes, written as hashes and returned in plaintext for the
  // one render of them there will be. Called again on a re-render, which
  // is why the page it feeds says the codes on it replace any earlier set.
  beginRecoveryCodes(realmId: string, subjectId: string): Promise<RecoveryCodesOffer>;
  // What the parked login is waiting for now that the action is done —
  // the same call the login route makes to re-render after a rejection.
  pendingChallenge(realmId: string, authSessionId: string): Promise<AuthenticatorResult>;
}

const FALLBACK_FORM = 'password';

function firstString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

// Deliberately not under /protocol/openid-connect/, for the reason
// login.ts gives: this is Odudu's own UI, not the OIDC wire protocol.
export function registerRequiredActionRoute(
  app: FastifyInstance,
  deps: RequiredActionRouteDeps,
): void {
  app.post<{
    Params: { realm: string };
    Querystring: { action?: string };
    Body: Record<string, string | string[] | undefined>;
  }>('/realms/:realm/login-actions/required-action', async (request, reply) => {
    const body = request.body;
    const realmName = request.params.realm;
    const outcome = await handleRequiredActionSubmission(deps, realmName, {
      authSessionId: firstString(body.auth_session_id),
      action: request.query.action,
      secret: firstString(body.secret),
      code: firstString(body.code),
      credential: firstString(body.credential),
      label: firstString(body.label),
    });

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

    if (outcome.kind === 'not_owed') {
      return sendHtml(
        reply,
        400,
        renderAuthorizeErrorPage('invalid_request', 'This account has no such pending action.'),
      );
    }

    if (outcome.kind === 'unsupported') {
      return sendHtml(
        reply,
        400,
        renderAuthorizeErrorPage(
          'invalid_request',
          'That pending action cannot be completed here yet.',
        ),
      );
    }

    const realm = await deps.findRealm(realmName);
    if (realm === null) {
      return sendHtml(reply, 400, renderAuthorizeErrorPage('invalid_request', 'Unknown realm.'));
    }

    // Back to the login form, not straight to a code: nothing was persisted
    // for the factor that authenticated this attempt, precisely so it runs
    // again (see advance() in @odudu/authn-flows), and this time the second
    // factor the enrolment just created runs after it.
    if (outcome.kind === 'completed') {
      const pending = await deps.pendingChallenge(realm.id, outcome.authSessionId);
      const form = pending.kind === 'challenge' ? pending.form : FALLBACK_FORM;
      return sendHtml(
        reply,
        200,
        renderLoginForm(realmName, outcome.authSessionId, form, deps.passkeyLogin ?? false),
      );
    }

    if (outcome.action === 'generate-recovery-codes') {
      const offer = await deps.beginRecoveryCodes(realm.id, outcome.subjectId);
      return sendHtml(
        reply,
        200,
        renderRecoveryCodesPage(realmName, outcome.authSessionId, offer, outcome.reason),
      );
    }

    if (outcome.action === 'configure-passkey') {
      const begin = deps.beginPasskeyEnrolment?.bind(deps);
      if (begin === undefined) {
        return sendHtml(
          reply,
          200,
          renderRequiredActionPage(realmName, outcome.authSessionId, outcome.action),
        );
      }
      // A retry needs its own challenge: the refused one is already gone.
      const passkey = await begin(realmName, realm.id, outcome.subjectId, outcome.authSessionId);
      return sendHtml(
        reply,
        200,
        renderPasskeyEnrolmentPage(realmName, outcome.authSessionId, passkey, outcome.reason),
      );
    }

    const offer = await deps.beginTotpEnrolment(realmName, realm.id, outcome.subjectId);
    return sendHtml(
      reply,
      200,
      renderTotpEnrolmentPage(realmName, outcome.authSessionId, offer, outcome.reason),
    );
  });
}
