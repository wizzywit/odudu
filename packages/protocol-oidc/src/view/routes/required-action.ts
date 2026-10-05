import {
  renderPasskeyEnrolmentPage,
  renderRecoveryCodesPage,
  renderRequiredActionPage,
  renderTotpEnrolmentPage,
  renderUpdatePasswordPage,
} from '@odudu/authn-flows';
import { requestContextFrom } from '@odudu/domain-audit';
import { PASSWORD_TOO_LONG, readPasswordField, type RenderedPage } from '@odudu/kernel';
import { type FastifyInstance } from 'fastify';
import { handleLoginSubmission, type LoginSubmissionDeps } from '#/usecase/login-submission';
import {
  handleRequiredActionSubmission,
  type RequiredActionSubmissionDeps,
} from '#/usecase/required-action-submission';
import { renderAuthorizeErrorPage } from '#/view/authorize-html';
import { sendHtml } from '#/view/html-response';
import { issuerBaseFor } from '#/view/issuer';
import { continuing } from '#/view/routes/continuation';
import { sendLoginOutcome, type LoginResponseDeps } from '#/view/routes/login-response';

// A finished action resumes the login it was parked on through the same
// gates the login form's POST runs, so this route carries both halves.
// The omitted members are declared, compatibly, by the submission deps.
export interface RequiredActionRouteDeps
  extends
    RequiredActionSubmissionDeps,
    Omit<LoginSubmissionDeps, 'findTenant' | 'pendingActions'>,
    Omit<LoginResponseDeps, 'findTenant' | 'loadPendingRequest'> {}

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
        await continuing(
          deps,
          tenantName,
          authSessionId,
          renderUpdatePasswordPage(tenantName, authSessionId, [PASSWORD_TOO_LONG.message]),
        ),
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
        await continuing(
          deps,
          tenantName,
          outcome.authSessionId,
          renderUpdatePasswordPage(tenantName, outcome.authSessionId, outcome.violations),
        ),
      );
    }

    const tenant = await deps.findTenant(tenantName);
    if (tenant === null) {
      return sendHtml(reply, 400, renderAuthorizeErrorPage('invalid_request', 'Unknown tenant.'));
    }
    const resumable = (page: RenderedPage) =>
      continuing(deps, tenantName, outcome.authSessionId, page);

    // The action is done, so the parked login resumes where it stopped:
    // nothing it already proved is asked for again, and whatever it still
    // owes — another action, a factor the action made apply, consent — is
    // what comes next. remember_me was parked when the detour began.
    if (outcome.kind === 'completed') {
      const pending = await deps.loadPendingRequest(tenant.id, outcome.authSessionId);
      const resumed = await handleLoginSubmission(
        deps,
        tenantName,
        issuerBaseFor(request),
        outcome.authSessionId,
        {},
        context,
        request.headers.cookie,
        pending?.rememberMe ?? false,
      );
      return sendLoginOutcome(reply, deps, tenantName, resumed);
    }

    if (outcome.action === 'generate-recovery-codes') {
      const offer = await deps.beginRecoveryCodes(tenant.id, outcome.subjectId, context);
      return sendHtml(
        reply,
        200,
        await resumable(
          renderRecoveryCodesPage(tenantName, outcome.authSessionId, offer, outcome.reason),
        ),
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
        await resumable(
          renderPasskeyEnrolmentPage(tenantName, outcome.authSessionId, passkey, outcome.reason),
        ),
      );
    }

    const offer = await deps.beginTotpEnrolment(tenantName, tenant.id, outcome.subjectId);
    return sendHtml(
      reply,
      200,
      await resumable(
        renderTotpEnrolmentPage(tenantName, outcome.authSessionId, offer, outcome.reason),
      ),
    );
  });
}
