import {
  listDomainsQuerySchema,
  passkeyImpactQuerySchema,
  registerDomainRequestSchema,
} from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { type FastifyReply } from 'fastify';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import {
  activateDomain,
  deactivateDomain,
  listDomains,
  passkeyImpact,
  readDomain,
  registerDomainFor,
  removeDomain,
  verifyDomainFor,
  type DomainsDeps,
  type SwitchDomainOutcome,
} from '#/usecase/domains';
import {
  canonicalProblem,
  failedProblem,
  notVerifiedProblem,
  REGISTER_REFUSALS,
  switchConflictProblem,
  verifyThrottledProblem,
} from '#/view/domain-problems';
import { cursorProblem, fieldProblem, ifMatchRequired, ifMatchStale, problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface DomainsRouteDeps extends DomainsDeps {
  readonly database: Database;
  readonly cursorKey: Uint8Array;
  readonly now: () => Date;
}

function tenantOf(request: AdminRequest, id: string): { id: string; name: string } {
  const name = request.params.tenant;
  if (name === undefined) throw new Error('protocol-admin: domains route received no :tenant');
  return { id, name };
}

function domainId(request: AdminRequest): string {
  const id = request.params.id;
  if (id === undefined) throw new Error('protocol-admin: domains route received no :id');
  return id;
}

function ifMatchHeader(request: AdminRequest): string | undefined {
  const value = request.headers['if-match'];
  return typeof value === 'string' ? value : undefined;
}

function notFound(request: AdminRequest, reply: FastifyReply, id: string): FastifyReply {
  return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found', `no domain ${id}`));
}

function answerSwitch(
  request: AdminRequest,
  reply: FastifyReply,
  id: string,
  outcome: SwitchDomainOutcome,
): FastifyReply {
  switch (outcome.kind) {
    case 'not_found':
      return notFound(request, reply, id);
    case 'not_verified':
      return sendProblem(reply, request, notVerifiedProblem());
    case 'no_base_url':
      return sendProblem(reply, request, REGISTER_REFUSALS.domain_no_base_url);
    case 'conflict':
      return sendProblem(reply, request, switchConflictProblem());
    case 'precondition_required':
      return sendProblem(
        reply,
        request,
        ifMatchRequired('the tenant’s address', request.headers['if-match']),
      );
    case 'precondition_failed':
      return sendProblem(reply, request, ifMatchStale());
    case 'ok':
      reply.header('etag', outcome.etag);
      return reply.code(200).send(outcome.domain);
  }
}

export function registerDomainHandler(deps: DomainsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const body = registerDomainRequestSchema.parse(request.body);
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      registerDomainFor(tx, deps, {
        tenant: tenantOf(request, targetTenantId),
        host: body.host,
        actorSubjectId: principal.subjectId,
        actorTenantId: principal.issuerTenantId,
        actorClientId: principal.clientDbId,
      }),
    );
    if (outcome.kind === 'refused') {
      return sendProblem(reply, request, REGISTER_REFUSALS[outcome.code]);
    }
    reply.header('etag', outcome.etag);
    return reply.code(201).send(outcome.domain);
  };
}

export function listDomainsHandler(deps: DomainsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const query = listDomainsQuerySchema.parse(request.query);
    const limit = coerceLimit(query.limit === undefined ? undefined : String(query.limit));
    const tenantName = tenantOf(request, targetTenantId).name;

    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      listDomains(tx, {
        limit,
        cursor: query.cursor,
        cursorKey: deps.cursorKey,
        tenantId: targetTenantId,
      }),
    );
    if (outcome.kind === 'invalid_cursor') return sendProblem(reply, request, cursorProblem());

    reply.header('etag', outcome.etag);
    if (outcome.next === null) return reply.code(200).send({ items: outcome.items });
    const nextUrl = nextPageUrl(`/admin/tenants/${tenantName}/domains`, {
      ...query,
      limit,
      cursor: outcome.next,
    });
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ items: outcome.items, next: outcome.next });
  };
}

export function readDomainHandler(deps: DomainsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const id = domainId(request);
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      readDomain(tx, { tenantId: targetTenantId, id }),
    );
    if (outcome.kind === 'not_found') return notFound(request, reply, id);
    reply.header('etag', outcome.etag);
    return reply.code(200).send(outcome.domain);
  };
}

export function verifyDomainHandler(deps: DomainsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = domainId(request);
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      verifyDomainFor(
        tx,
        deps,
        {
          tenant: tenantOf(request, targetTenantId),
          id,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
        deps.now(),
      ),
    );
    switch (outcome.kind) {
      case 'not_found':
        return notFound(request, reply, id);
      case 'failed':
        return sendProblem(reply, request, failedProblem());
      case 'verified_elsewhere':
        return sendProblem(reply, request, REGISTER_REFUSALS.domain_verified_elsewhere);
      case 'throttled':
        reply.header('retry-after', String(outcome.retryAfterSeconds));
        return sendProblem(reply, request, verifyThrottledProblem());
      case 'ok':
        reply.header('etag', outcome.etag);
        return reply.code(200).send(outcome.domain);
    }
  };
}

export function activateDomainHandler(deps: DomainsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = domainId(request);
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      activateDomain(
        tx,
        deps,
        {
          tenant: tenantOf(request, targetTenantId),
          id,
          ifMatch: ifMatchHeader(request),
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
        deps.now(),
      ),
    );
    return answerSwitch(request, reply, id, outcome);
  };
}

export function deactivateDomainHandler(deps: DomainsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = domainId(request);
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      deactivateDomain(
        tx,
        deps,
        {
          tenant: tenantOf(request, targetTenantId),
          id,
          ifMatch: ifMatchHeader(request),
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
        deps.now(),
      ),
    );
    return answerSwitch(request, reply, id, outcome);
  };
}

export function removeDomainHandler(deps: DomainsRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, targetTenantId) => {
    const id = domainId(request);
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      removeDomain(tx, deps, {
        tenantId: targetTenantId,
        id,
        actorSubjectId: principal.subjectId,
        actorTenantId: principal.issuerTenantId,
        actorClientId: principal.clientDbId,
      }),
    );
    switch (outcome.kind) {
      case 'not_found':
        return notFound(request, reply, id);
      case 'canonical':
        return sendProblem(reply, request, canonicalProblem());
      case 'removed':
        return reply.code(204).send();
    }
  };
}

export function passkeyImpactHandler(deps: DomainsRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, targetTenantId) => {
    const query = passkeyImpactQuerySchema.parse(request.query);
    const outcome = await adminTx(deps.database, request, targetTenantId, (tx) =>
      passkeyImpact(tx, deps, { tenantId: targetTenantId, target: query.canonical }),
    );
    switch (outcome.kind) {
      case 'invalid':
        return sendProblem(
          reply,
          request,
          fieldProblem([{ path: 'canonical', message: 'is neither path nor a host' }]),
        );
      case 'not_found':
        return sendProblem(
          reply,
          request,
          problem(404, 'about:blank', 'Not Found', `no domain ${query.canonical}`),
        );
      case 'ok':
        return reply.code(200).send({ subjects: outcome.subjects, capped: outcome.capped });
    }
  };
}
