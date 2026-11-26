import {
  ASSISTANT_SETTING_DEFAULTS,
  putAssistantSettingsRequestSchema,
  type AssistantSettings,
  type AssistantStatus,
} from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { type FastifyReply } from 'fastify';
import {
  putAssistantSettings,
  readAssistantSettings,
  type Audit,
  type AssistantSettingsStore,
} from '#/usecase/assistant-settings';
import { ifMatchStale, problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface AssistantRouteDeps {
  readonly database: Database;
  readonly audit: Audit;
  readonly now: () => Date;
  // What the status answers for a tenant with these settings. The assistant
  // package computes it from the environment and cannot be imported here.
  readonly status: (settings: AssistantSettings) => AssistantStatus;
  // Absent where the deployment has no assistant: the settings routes then
  // answer as a path that was never served, and the status is `enabled: false`.
  readonly store?: AssistantSettingsStore;
}

function ifMatchHeader(request: AdminRequest): string | undefined {
  const value = request.headers['if-match'];
  return typeof value === 'string' ? value : undefined;
}

// The answer a path that was never served gets, word for word, so that a
// deployment without an assistant cannot be told from one that never had these routes.
function notServed(request: AdminRequest, reply: FastifyReply): FastifyReply {
  return sendProblem(
    reply,
    request,
    problem(404, 'about:blank#not-found', 'Not Found', 'No resource at this path'),
  );
}

export function assistantStatusHandler(deps: AssistantRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, tenantId): Promise<FastifyReply> => {
    const store = deps.store;
    if (store === undefined) return reply.code(200).send(deps.status(ASSISTANT_SETTING_DEFAULTS));
    const { settings } = await adminTx(deps.database, request, tenantId, (tx) =>
      readAssistantSettings({ store }, tx, tenantId),
    );
    return reply.code(200).send(deps.status(settings));
  };
}

export function readAssistantSettingsHandler(deps: AssistantRouteDeps): AdminRouteHandler {
  return async (request, reply, _principal, tenantId): Promise<FastifyReply> => {
    const store = deps.store;
    if (store === undefined) return notServed(request, reply);
    const { settings, etag } = await adminTx(deps.database, request, tenantId, (tx) =>
      readAssistantSettings({ store }, tx, tenantId),
    );
    return reply.header('etag', etag).code(200).send(settings);
  };
}

export function putAssistantSettingsHandler(deps: AssistantRouteDeps): AdminRouteHandler {
  return async (request, reply, principal, tenantId): Promise<FastifyReply> => {
    const store = deps.store;
    if (store === undefined) return notServed(request, reply);
    const settings = putAssistantSettingsRequestSchema.parse(request.body);
    const outcome = await adminTx(deps.database, request, tenantId, (tx) =>
      putAssistantSettings({ store, audit: deps.audit, now: deps.now }, tx, {
        tenantId,
        settings,
        ifMatch: ifMatchHeader(request),
        actorSubjectId: principal.subjectId,
        actorTenantId: principal.issuerTenantId,
        actorClientId: principal.clientDbId,
      }),
    );
    if (outcome.kind === 'precondition_failed') {
      return sendProblem(reply, request, ifMatchStale());
    }
    return reply.header('etag', outcome.etag).code(200).send(outcome.settings);
  };
}
