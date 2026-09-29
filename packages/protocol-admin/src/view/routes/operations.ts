import {
  listLogoutDeliveriesQuerySchema,
  listMailQuerySchema,
  type ClientInstallation,
} from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { tenantIssuerFor } from '@odudu/protocol-oidc';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import { readClient } from '#/usecase/clients';
import { listLogoutDeliveries } from '#/usecase/logout-deliveries';
import { listMail } from '#/usecase/mail';
import { cursorProblem, problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRouteHandler } from '#/view/routes/router';

export interface OperationsRouteDeps {
  readonly database: Database;
  readonly cursorKey: Uint8Array;
  readonly outboxMaxAttempts: number;
  readonly callerCapabilities: (
    issuerTenantId: string,
    subjectId: string,
  ) => Promise<ReadonlySet<string>>;
}

// A recipient is a subject's address, which reading takes `view-users`
// everywhere else; `manage-tenant` alone sees that mail went and whether
// it failed, not to whom.
export function listMailHandler(deps: OperationsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const tenantName = request.params.tenant;
    if (tenantName === undefined) throw new Error('protocol-admin: mail route received no :tenant');
    const query = listMailQuerySchema.parse(request.query);
    const limit = coerceLimit(query.limit === undefined ? undefined : String(query.limit));
    const held = await deps.callerCapabilities(principal.issuerTenantId, principal.subjectId);
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      listMail(tx, {
        tenantId: targetTenantId,
        status: query.status,
        revealRecipients: held.has('view-users'),
        maxAttempts: deps.outboxMaxAttempts,
        limit,
        cursor: query.cursor,
        cursorKey: deps.cursorKey,
      }),
    );
    if (outcome.kind === 'invalid_cursor') return sendProblem(reply, request, cursorProblem());
    if (outcome.next === null) return reply.code(200).send({ items: outcome.items });
    const nextUrl = nextPageUrl(`/admin/tenants/${tenantName}/mail`, {
      ...query,
      limit,
      cursor: outcome.next,
    });
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items: outcome.items, next: outcome.next });
  };
}

export function listLogoutDeliveriesHandler(deps: OperationsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const { tenant, id } = request.params;
    if (tenant === undefined || id === undefined) {
      throw new Error('protocol-admin: logout-deliveries route received no :tenant/:id');
    }
    const query = listLogoutDeliveriesQuerySchema.parse(request.query);
    const limit = coerceLimit(query.limit === undefined ? undefined : String(query.limit));
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      listLogoutDeliveries(tx, {
        tenantId: targetTenantId,
        clientDbId: id,
        status: query.status,
        limit,
        cursor: query.cursor,
        cursorKey: deps.cursorKey,
      }),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', `no client ${id}`),
      );
    }
    if (outcome.kind === 'invalid_cursor') return sendProblem(reply, request, cursorProblem());
    if (outcome.next === null) return reply.code(200).send({ items: outcome.items });
    const nextUrl = nextPageUrl(`/admin/tenants/${tenant}/clients/${id}/logout-deliveries`, {
      ...query,
      limit,
      cursor: outcome.next,
    });
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items: outcome.items, next: outcome.next });
  };
}

// The issuer as this request's own host names it, the one discovery at the
// same host answers: what a relying party configured from here will be
// checking `iss` against.
export function readInstallationHandler(deps: OperationsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const { tenant, id } = request.params;
    if (tenant === undefined || id === undefined) {
      throw new Error('protocol-admin: installation route received no :tenant/:id');
    }
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      readClient(tx, id),
    );
    if (outcome.kind === 'not_found') {
      return sendProblem(
        reply,
        request,
        problem(404, 'about:blank', 'Not Found', `no client ${id}`),
      );
    }
    const client = outcome.client;
    const issuer = tenantIssuerFor(request, tenant);
    const installation: ClientInstallation = {
      issuer,
      discovery_url: `${issuer}/.well-known/openid-configuration`,
      client_id: client.clientId,
      client_type: client.type,
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
      redirect_uris: [...client.redirectUris],
      post_logout_redirect_uris: [...client.postLogoutRedirectUris],
      grant_types: [...client.grantTypes],
      default_scope: client.scopes
        .filter((scope) => scope.assignment === 'default')
        .map((scope) => scope.name)
        .join(' '),
    };
    return reply.code(200).send(installation);
  };
}
