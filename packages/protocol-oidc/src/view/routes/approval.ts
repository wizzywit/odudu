import { withTenant, type DatabaseHandle } from '@odudu/db';
import { requestContextFrom } from '@odudu/domain-audit';
import {
  addressPath,
  isUuid,
  pathAddress,
  systemClock,
  tenantAddressOf,
  type Clock,
} from '@odudu/kernel';
import { type PresentedSession } from '@odudu/authn-flows';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { showApproval, submitApproval, type ApprovalTenant } from '#/usecase/approval-page';
import {
  renderApprovalDecidedPage,
  renderApprovalPage,
  renderApprovalRefusedPage,
  renderApprovalSignInPage,
  renderApprovalUnavailablePage,
} from '#/view/approval-html';
import { sendHtml } from '#/view/html-response';
import {
  brandedRequestLocale,
  lookingUpTenantOnce,
  type ContinuationDeps,
} from '#/view/routes/continuation';

const PATH = '/tenants/:tenant/approval/:id';

export interface ApprovalRouteDeps extends Pick<
  ContinuationDeps,
  'resolveBranding' | 'resolveOverrides'
> {
  database: DatabaseHandle;
  findTenant(name: string): Promise<ApprovalTenant | null>;
  // The browser's session cookies, resolved to their live rows.
  resolveSessions(
    tenant: {
      id: string;
      name: string;
      ssoSessionIdleSeconds: number;
      ssoSessionMaxSeconds: number;
      rememberMeIdleSeconds: number;
      rememberMeMaxSeconds: number;
    },
    header: string | undefined,
  ): Promise<PresentedSession[]>;
  // Where a person with no session signs in, with this page as the way back;
  // null where the deployment has none.
  signIn: (tenantName: string, returnPath: string) => string | null;
  clock?: Clock;
}

interface Params {
  tenant: string;
  id: string;
}

// A page that is not a decision in the making is answered with one status and
// one body, so nothing it says depends on whose approval was asked for.
function unavailable(reply: FastifyReply, deps: ApprovalRouteDeps, tenant: string) {
  return brandedRequestLocale(deps, reply, tenant).then((locale) =>
    sendHtml(reply, 404, renderApprovalUnavailablePage(locale)),
  );
}

// 403 and not 401 for a deployment with nowhere to send the person: there is
// no scheme to challenge with, the session is a cookie another door sets.
async function signIn(
  reply: FastifyReply,
  deps: ApprovalRouteDeps,
  request: FastifyRequest<{ Params: Params }>,
): Promise<FastifyReply> {
  const { tenant, id } = request.params;
  const location = deps.signIn(tenant, addressPath(pathAddress('', tenant), `/approval/${id}`));
  if (location === null) {
    const locale = await brandedRequestLocale(deps, reply, tenant);
    return sendHtml(reply, 403, renderApprovalSignInPage(locale));
  }
  return reply.header('cache-control', 'no-store').redirect(location, 302);
}

// The CIBA approval page, reached from the mail an approval sends. It is Odudu's
// own UI, so it sits beside the login actions and not under the protocol path.
// Only a person's own session decides: the form's token is bound to that
// session and to this approval, and no client credential is read at all.
export function registerApprovalRoute(app: FastifyInstance, routeDeps: ApprovalRouteDeps): void {
  const clock = routeDeps.clock ?? systemClock;

  app.get<{ Params: Params }>(PATH, async (request, reply) => {
    const deps = lookingUpTenantOnce(routeDeps);
    const tenant = await deps.findTenant(request.params.tenant);
    if (!tenant?.enabled) return reply.code(404).send();
    const sessions = await deps.resolveSessions(
      { ...tenant, name: request.params.tenant },
      request.headers.cookie,
    );
    if (sessions.length === 0) return signIn(reply, deps, request);
    if (!isUuid(request.params.id)) return unavailable(reply, deps, request.params.tenant);

    const now = clock.now();
    const shown = await withTenant(
      deps.database.db,
      tenant.id,
      (tx) => showApproval(tx, { approvalId: request.params.id, sessions, now }),
      requestContextFrom(request),
    );
    if (shown.kind === 'unavailable') return unavailable(reply, deps, request.params.tenant);
    const locale = await brandedRequestLocale(deps, reply, request.params.tenant);
    return sendHtml(
      reply,
      200,
      renderApprovalPage(
        {
          address: tenantAddressOf(request),
          approvalId: shown.details.approvalId,
          csrf: shown.csrf,
          tenant: shown.details.tenant,
          agent: shown.details.agent,
          summary: shown.details.summary,
          scope: shown.details.scope,
          bindingMessage: shown.details.bindingMessage,
          expiresAt: shown.details.expiresAt,
        },
        locale,
      ),
    );
  });

  app.post<{ Params: Params; Body: Record<string, string | string[] | undefined> | undefined }>(
    PATH,
    async (request, reply) => {
      const deps = lookingUpTenantOnce(routeDeps);
      const tenant = await deps.findTenant(request.params.tenant);
      if (!tenant?.enabled) return reply.code(404).send();
      const sessions = await deps.resolveSessions(
        { ...tenant, name: request.params.tenant },
        request.headers.cookie,
      );
      if (sessions.length === 0) return signIn(reply, deps, request);
      if (!isUuid(request.params.id)) return unavailable(reply, deps, request.params.tenant);

      const body = request.body ?? {};
      const outcome = await withTenant(
        deps.database.db,
        tenant.id,
        (tx) =>
          submitApproval(
            tx,
            { tenantId: tenant.id },
            {
              approvalId: request.params.id,
              sessions,
              csrf: typeof body.csrf === 'string' ? body.csrf : '',
              choice: typeof body.decision === 'string' ? body.decision : undefined,
              now: clock.now(),
            },
          ),
        requestContextFrom(request),
      );
      if (outcome.kind === 'unavailable') return unavailable(reply, deps, request.params.tenant);
      const locale = await brandedRequestLocale(deps, reply, request.params.tenant);
      if (outcome.kind === 'refused') {
        return sendHtml(reply, 403, renderApprovalRefusedPage(locale));
      }
      return sendHtml(reply, 200, renderApprovalDecidedPage(outcome.decision, locale));
    },
  );
}
