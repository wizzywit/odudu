import {
  listAssistantActivityQuerySchema,
  REPORTED_WARN_AT,
  type ListAssistantActivityResponse,
  type ReportConversationResponse,
} from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { type FastifyReply } from 'fastify';
import { coerceLimit, nextPageUrl } from '#/service/cursor';
import {
  exportAssistantConversation,
  isConversationId,
  listAssistantActivity,
  replayAssistantConversation,
  reportAssistantConversation,
  type AssistantActivityStore,
  type Reader,
  type ReportAudit,
} from '#/usecase/assistant-activity';
import { type AssistantSettingsStore } from '#/usecase/assistant-settings';
import { cursorProblem, problem, queryProblem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface AssistantActivityRouteDeps {
  readonly database: Database;
  readonly cursorKey: Uint8Array;
  readonly audit: ReportAudit;
  readonly now: () => Date;
  readonly callerCapabilities: (
    issuerTenantId: string,
    subjectId: string,
  ) => Promise<ReadonlySet<string>>;
  // Both absent where the deployment has no assistant: every route here then
  // answers as a path that was never served.
  readonly store?: AssistantActivityStore;
  readonly settings?: AssistantSettingsStore;
}

// What a path that was never served gets, word for word: a deployment with no
// assistant, a tenant whose auditors may not read conversations, and a
// conversation that is not there are told the same thing.
function notServed(request: AdminRequest, reply: FastifyReply): FastifyReply {
  return sendProblem(
    reply,
    request,
    problem(404, 'about:blank#not-found', 'Not Found', 'No resource at this path'),
  );
}

function readerOf(principal: {
  readonly subjectId: string;
  readonly issuerTenantId: string;
  readonly clientDbId: string;
}): Reader {
  return {
    subjectId: principal.subjectId,
    tenantId: principal.issuerTenantId,
    clientId: principal.clientDbId,
  };
}

function parts(deps: AssistantActivityRouteDeps) {
  const { store, settings } = deps;
  if (store === undefined || settings === undefined) return undefined;
  return {
    store,
    settings,
    cursorKey: deps.cursorKey,
    audit: deps.audit,
    now: deps.now,
  };
}

export function listAssistantActivityHandler(deps: AssistantActivityRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, tenantId) => {
    const wired = parts(deps);
    if (wired === undefined) return notServed(request, reply);
    const parsed = listAssistantActivityQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendProblem(reply, request, queryProblem(parsed.error));
    const { cursor, limit: rawLimit, ...filters } = parsed.data;
    const limit = coerceLimit(rawLimit === undefined ? undefined : String(rawLimit));
    const outcome = await adminTx(deps.database, request, tenantId, (tx) =>
      listAssistantActivity(wired, tx, { tenantId, filters, limit, cursor }),
    );
    if (outcome.kind === 'invalid_cursor') return sendProblem(reply, request, cursorProblem());
    const body: ListAssistantActivityResponse = { items: outcome.items };
    if (outcome.next === null) return reply.code(200).send(body);
    const nextUrl = nextPageUrl(
      `/admin/tenants/${request.params.tenant ?? ''}/assistant/activity`,
      { ...filters, limit, cursor: outcome.next },
    );
    reply.header('link', `<${nextUrl}>; rel="next"`);
    return reply.code(200).send({ ...body, next: outcome.next });
  };
}

export function replayAssistantConversationHandler(
  deps: AssistantActivityRouteDeps,
): AdminRouteHandler {
  return async (request, reply, principal, tenantId) => {
    const wired = parts(deps);
    const id = request.params.id;
    if (wired === undefined || !isConversationId(id)) return notServed(request, reply);
    const outcome = await adminTx(deps.database, request, tenantId, (tx) =>
      replayAssistantConversation(wired, tx, tenantId, id, readerOf(principal)),
    );
    return outcome.kind === 'ok' ? reply.code(200).send(outcome.value) : notServed(request, reply);
  };
}

export function exportAssistantConversationHandler(
  deps: AssistantActivityRouteDeps,
): AdminRouteHandler {
  return async (request, reply, principal, tenantId) => {
    const wired = parts(deps);
    const id = request.params.id;
    if (wired === undefined || !isConversationId(id)) return notServed(request, reply);
    const outcome = await adminTx(deps.database, request, tenantId, (tx) =>
      exportAssistantConversation(wired, tx, tenantId, id, readerOf(principal)),
    );
    if (outcome.kind !== 'ok') return notServed(request, reply);
    return reply
      .header('content-disposition', `attachment; filename="assistant-${id}.promptfoo.json"`)
      .code(200)
      .send(outcome.value);
  };
}

export function reportAssistantConversationHandler(
  deps: AssistantActivityRouteDeps,
): AdminRouteHandler {
  return async (request, reply, principal, tenantId) => {
    const wired = parts(deps);
    const id = request.params.id;
    if (wired === undefined || !isConversationId(id)) return notServed(request, reply);
    const held = await deps.callerCapabilities(principal.issuerTenantId, principal.subjectId);
    const outcome = await adminTx(deps.database, request, tenantId, (tx) =>
      reportAssistantConversation(wired, tx, {
        tenantId,
        conversationId: id,
        actorSubjectId: principal.subjectId,
        actorTenantId: principal.issuerTenantId,
        actorClientId: principal.clientDbId,
        holdsActivityCapability: held.has('read-assistant-activity'),
      }),
    );
    if (outcome.kind === 'not_found') return notServed(request, reply);
    if (outcome.kind === 'full') {
      return sendProblem(
        reply,
        request,
        problem(
          409,
          'about:blank',
          'Conflict',
          'this tenant already keeps as many reported conversations as it may',
        ),
      );
    }
    const body: ReportConversationResponse = {
      reported_at: outcome.at.toISOString(),
      reported_count: outcome.count,
      near_limit: outcome.count >= REPORTED_WARN_AT,
    };
    return reply.code(200).send(body);
  };
}
