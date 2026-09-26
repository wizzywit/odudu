import {
  renderPasskeyEnrolmentPage,
  renderRecoveryCodesPage,
  renderRequiredActionPage,
  renderTotpEnrolmentPage,
  renderUpdatePasswordPage,
  type AuthenticatorResult,
  type PasskeyEnrolmentOffer,
  type RecoveryCodesOffer,
  type TotpEnrolmentOffer,
} from '@odudu/authn-flows';
import { requestContextFrom, type RequestContext } from '@odudu/domain-audit';
import { PASSWORD_TOO_LONG, readPasswordField } from '@odudu/kernel';
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
    tenantName: string,
    tenantId: string,
    subjectId: string,
  ): Promise<TotpEnrolmentOffer>;
  // Fresh creation options, and a fresh challenge parked on the attempt, for
  // a retry after a refused ceremony. Absent on a deployment with no
  // relying party to name.
  beginPasskeyEnrolment?(
    tenantName: string,
    tenantId: string,
    subjectId: string,
    authSessionId: string,
  ): Promise<PasskeyEnrolmentOffer>;
  // Ten fresh codes, written as hashes and returned in plaintext for the
  // one render of them there will be. Called again on a re-render, which
  // is why the page it feeds says the codes on it replace any earlier set.
  beginRecoveryCodes(
    tenantId: string,
    subjectId: string,
    request: RequestContext,
  ): Promise<RecoveryCodesOffer>;
  // What the parked login is waiting for now that the action is done —
  // the same call the login route makes to re-render after a rejection.
  pendingChallenge(tenantId: string, authSessionId: string): Promise<AuthenticatorResult>;
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
    Params: { tenant: string };
    Querystring: { action?: string };
    Body: Record<string, string | string[] | undefined>;
  }>('/tenants/:tenant/login-actions/required-action', async (request, reply) => {
    const body = request.body;
    const tenantName = request.params.tenant;
    const authSessionId = firstString(body.auth_session_id);
    const candidate = readPasswordField(body.password);

    // Back to the same form with the rule it broke, as a refused candidate
    // is — but decided here, before the submission reaches the hash. Only
    // for the action that reads a password: a field the submitted action
    // never looks at is ignored, not answered with another action's page,
    // and an attempt naming no session has nothing to re-render.
    if (
      candidate.kind === 'too_long' &&
      request.query.action === 'update-password' &&
      authSessionId !== undefined
    ) {
      return sendHtml(
        reply,
        400,
        renderUpdatePasswordPage(tenantName, authSessionId, [PASSWORD_TOO_LONG.message]),
      );
    }

    const context = requestContextFrom(request);
    const outcome = await handleRequiredActionSubmission(
      deps,
      tenantName,
      {
        authSessionId,
        action: request.query.action,
        secret: firstString(body.secret),
        code: firstString(body.code),
        password: candidate.kind === 'present' ? candidate.password : undefined,
        credential: firstString(body.credential),
        label: firstString(body.label),
      },
      context,
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

    // Back to the same form with every rule it broke, and 400 for the same
    // reason registration and reset redemption answer one: the submission
    // was refused, so a 200 would tell a client the password had changed.
    if (outcome.kind === 'password_rejected') {
      return sendHtml(
        reply,
        400,
        renderUpdatePasswordPage(tenantName, outcome.authSessionId, outcome.violations),
      );
    }

    const tenant = await deps.findTenant(tenantName);
    if (tenant === null) {
      return sendHtml(reply, 400, renderAuthorizeErrorPage('invalid_request', 'Unknown tenant.'));
    }

    // Back to the login form, not straight to a code: nothing was persisted
    // for the factor that authenticated this attempt, precisely so it runs
    // again (see advance() in @odudu/authn-flows), and this time the second
    // factor the enrolment just created runs after it.
    if (outcome.kind === 'completed') {
      const pending = await deps.pendingChallenge(tenant.id, outcome.authSessionId);
      const form = pending.kind === 'challenge' ? pending.form : FALLBACK_FORM;
      return sendHtml(
        reply,
        200,
        renderLoginForm(
          tenantName,
          outcome.authSessionId,
          form,
          deps.passkeyLogin ?? false,
          tenant.rememberMeAllowed,
        ),
      );
    }

    if (outcome.action === 'generate-recovery-codes') {
      const offer = await deps.beginRecoveryCodes(tenant.id, outcome.subjectId, context);
      return sendHtml(
        reply,
        200,
        renderRecoveryCodesPage(tenantName, outcome.authSessionId, offer, outcome.reason),
      );
    }

    if (outcome.action === 'configure-passkey') {
      const begin = deps.beginPasskeyEnrolment?.bind(deps);
      if (begin === undefined) {
        return sendHtml(reply, 200, renderRequiredActionPage(outcome.action));
      }
      // A retry needs its own challenge: the refused one is already gone.
      const passkey = await begin(tenantName, tenant.id, outcome.subjectId, outcome.authSessionId);
      return sendHtml(
        reply,
        200,
        renderPasskeyEnrolmentPage(tenantName, outcome.authSessionId, passkey, outcome.reason),
      );
    }

    const offer = await deps.beginTotpEnrolment(tenantName, tenant.id, outcome.subjectId);
    return sendHtml(
      reply,
      200,
      renderTotpEnrolmentPage(tenantName, outcome.authSessionId, offer, outcome.reason),
    );
  });
}
