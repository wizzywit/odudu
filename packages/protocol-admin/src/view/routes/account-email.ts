import { sendActionsEmailRequestSchema } from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import {
  sendAccountEmail,
  type AccountEmailDeps,
  type AccountEmailPurpose,
} from '#/usecase/account-email';
import { problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';
import { targetCeilingProblem } from '#/view/routes/subjects';

export interface AccountEmailRouteDeps extends AccountEmailDeps {
  readonly database: Database;
  readonly callerCapabilities: (
    issuerTenantId: string,
    subjectId: string,
  ) => Promise<ReadonlySet<string>>;
}

type PurposeOf = (request: AdminRequest) => AccountEmailPurpose;

// The two self-service links and the actions link share this one core:
// the same lookups, ceiling, refusals, mail and audit, told apart only by
// the link they ask `@odudu/account` to mint.
function accountEmailHandler(deps: AccountEmailRouteDeps, purposeOf: PurposeOf): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const { id, tenant: tenantName } = request.params;
    if (id === undefined || tenantName === undefined) {
      throw new Error('protocol-admin: account email route received no :tenant/:id');
    }
    const purpose = purposeOf(request);
    const callerCapabilities = await deps.callerCapabilities(
      principal.issuerTenantId,
      principal.subjectId,
    );
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      sendAccountEmail(tx, deps, {
        ...purpose,
        tenantId: targetTenantId,
        tenantName,
        subjectId: id,
        callerCapabilities,
        actorSubjectId: principal.subjectId,
        actorTenantId: principal.issuerTenantId,
        actorClientId: principal.clientDbId,
      }),
    );
    switch (outcome.kind) {
      case 'queued':
        return reply.code(202).send();
      case 'not_found':
        return sendProblem(
          reply,
          request,
          problem(404, 'about:blank', 'Not Found', `no user subject ${id}`),
        );
      case 'target_ceiling':
        return targetCeilingProblem(reply, request, outcome.requested);
      case 'no_email':
        return sendProblem(
          reply,
          request,
          problem(
            409,
            'about:blank#no-email',
            'Conflict',
            'the subject has no email address to send to',
          ),
        );
      case 'reset_password_off':
        return sendProblem(
          reply,
          request,
          problem(
            409,
            'about:blank#reset-password-off',
            'Conflict',
            'reset_password_allowed is off, so the tenant would refuse the link; turn it on with PATCH /settings first',
          ),
        );
      case 'no_mail_relay':
        return sendProblem(
          reply,
          request,
          problem(
            409,
            'about:blank#no-mail-relay',
            'Conflict',
            'the tenant has no relay and the deployment no sender, so the mail would only be logged',
          ),
        );
      case 'unavailable':
        request.log.error(
          { tenant: tenantName },
          'account email refused: ODUDU_PUBLIC_BASE_URL is unset',
        );
        return sendProblem(
          reply,
          request,
          problem(
            503,
            'about:blank',
            'Service Unavailable',
            'the deployment has no public base URL to put in a link',
          ),
        );
    }
  };
}

export function sendPasswordResetHandler(deps: AccountEmailRouteDeps): AdminRouteHandler {
  return accountEmailHandler(deps, () => ({ kind: 'reset_password' }));
}

export function sendVerificationHandler(deps: AccountEmailRouteDeps): AdminRouteHandler {
  return accountEmailHandler(deps, () => ({ kind: 'verify_email' }));
}

export function sendActionsEmailHandler(deps: AccountEmailRouteDeps): AdminRouteHandler {
  return accountEmailHandler(deps, (request) => {
    // Already validated by the router against this schema; parsing narrows the type.
    const body = sendActionsEmailRequestSchema.parse(request.body);
    return {
      kind: 'execute_actions',
      actions: body.actions,
    };
  });
}
