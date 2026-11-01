import { previewMailQuerySchema } from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { mailPreviewHeaders } from '@odudu/kernel';
import { issuerBaseFor } from '@odudu/protocol-oidc';
import { logoOrigins, mailBrandingView } from '#/service/mail-preview';
import { clientMail, previewMail, tenantMail, type MailPreviewDeps } from '#/usecase/mail-preview';
import { problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRouteHandler } from '#/view/routes/router';

export interface MailPreviewRouteDeps extends MailPreviewDeps {
  readonly database: Database;
  readonly now: () => Date;
}

function tenantNameOf(request: { params: { tenant?: string } }): string {
  const name = request.params.tenant;
  if (name === undefined) throw new Error('protocol-admin: a mail route received no :tenant');
  return name;
}

function clientRowIdOf(request: { params: { id?: string } }): string {
  const id = request.params.id;
  if (id === undefined) throw new Error('protocol-admin: a client mail route received no :id');
  return id;
}

// The tenant's mail view and a client's differ in whose look is asked for; a
// client the tenant does not hold is `404` whatever the reason.
export function mailPreviewHandler(
  deps: MailPreviewRouteDeps,
  scope: 'tenant' | 'client' = 'tenant',
): AdminRouteHandler {
  return async (request, reply, _principal, tenantId) => {
    const query = previewMailQuerySchema.parse(request.query);
    const tenantName = tenantNameOf(request);
    const mail = await adminTx(deps.database, request, tenantId, (tx) =>
      scope === 'client'
        ? clientMail(tx, deps, { tenantId, tenantName }, clientRowIdOf(request))
        : tenantMail(tx, deps, { tenantId, tenantName }),
    );
    if (mail === null) return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
    const shown = previewMail(mail, {
      query,
      issuerBase: issuerBaseFor(request),
      now: deps.now(),
    });
    reply.code(200).header('content-type', 'text/html; charset=utf-8');
    for (const [name, value] of mailPreviewHeaders(logoOrigins(shown.branding))) {
      reply.header(name, value);
    }
    return reply.send(shown.html);
  };
}

export function mailBrandingHandler(
  deps: MailPreviewRouteDeps,
  scope: 'tenant' | 'client' = 'tenant',
): AdminRouteHandler {
  return async (request, reply, _principal, tenantId) => {
    const tenantName = tenantNameOf(request);
    if (scope === 'tenant') {
      const mail = await adminTx(deps.database, request, tenantId, (tx) =>
        tenantMail(tx, deps, { tenantId, tenantName }, false),
      );
      return reply.code(200).send(mailBrandingView(mail.branding));
    }
    const mail = await adminTx(deps.database, request, tenantId, (tx) =>
      clientMail(tx, deps, { tenantId, tenantName }, clientRowIdOf(request), false),
    );
    if (mail === null) return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
    return reply.code(200).send(mailBrandingView(mail.branding, mail.tenantBranding));
  };
}
