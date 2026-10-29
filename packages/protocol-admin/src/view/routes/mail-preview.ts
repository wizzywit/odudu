import { previewMailQuerySchema } from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { mailPreviewHeaders } from '@odudu/kernel';
import { issuerBaseFor } from '@odudu/protocol-oidc';
import { logoOrigins, mailBrandingView } from '#/service/mail-preview';
import { previewMail, tenantMail, type MailPreviewDeps } from '#/usecase/mail-preview';
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

export function mailPreviewHandler(deps: MailPreviewRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, tenantId) => {
    const query = previewMailQuerySchema.parse(request.query);
    const tenantName = tenantNameOf(request);
    const mail = await adminTx(deps.database, request, tenantId, (tx) =>
      tenantMail(tx, deps, { tenantId, tenantName }),
    );
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

export function mailBrandingHandler(deps: MailPreviewRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, tenantId) => {
    const tenantName = tenantNameOf(request);
    const mail = await adminTx(deps.database, request, tenantId, (tx) =>
      tenantMail(tx, deps, { tenantId, tenantName }, false),
    );
    return reply.code(200).send(mailBrandingView(mail.branding));
  };
}
