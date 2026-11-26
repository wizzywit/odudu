import {
  ASSISTANT_SETTING_DEFAULTS,
  putAssistantSettingsRequestSchema,
  type AssistantConversation,
  type AssistantSettings,
  type AssistantStatus,
  type CreateConversationRequest,
  type SendMessageRequest,
} from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { tenantIssuerFor } from '@odudu/protocol-oidc';
import { type FastifyReply, type FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import {
  putAssistantSettings,
  readAssistantSettings,
  type Audit,
  type AssistantSettingsDeps,
  type AssistantSettingsStore,
} from '#/usecase/assistant-settings';
import { ifMatchStale, problem, sendProblem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface AssistantRouteDeps {
  readonly database: Database;
  readonly audit: Audit;
  readonly now: () => Date;
  // Takes the tenant's row lock for a save (see `AssistantSettingsDeps`).
  readonly lock: AssistantSettingsDeps['lock'];
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

// Settings are the tenant's configuration, with no owner subject: the door's
// capability check (manage-tenants as well, from another tenant) is the whole
// of who may reach them, as for every other tenant-configuration route.
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
      putAssistantSettings({ store, audit: deps.audit, lock: deps.lock, now: deps.now }, tx, {
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

/**
 * The administrator a chat call is made for, as this door resolved them. The
 * assistant package, which sits above this one, supplies the port below and
 * takes this shape structurally.
 */
export interface AssistantCaller {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly issuer: string;
  readonly ownerSubjectId: string;
  readonly grantId: string | undefined;
  readonly requestId: string;
  readonly ip: string;
}

/**
 * What the chat routes call. Absent when no model is configured, in which case
 * every route but `status` answers 404, so the assistant's existence is not
 * disclosed to a caller who holds the capability.
 */
export interface AssistantChatPort {
  create(
    caller: AssistantCaller,
    body: CreateConversationRequest,
  ): Promise<
    { kind: 'created'; conversation: AssistantConversation } | { kind: 'unknown_profile' }
  >;
  load(caller: AssistantCaller, id: string): Promise<AssistantConversation | null>;
  send(
    caller: AssistantCaller,
    id: string,
    message: SendMessageRequest['message'],
    signal: AbortSignal,
  ): Promise<
    | { kind: 'stream'; response: Response }
    | { kind: 'not_found' }
    | { kind: 'busy' }
    | { kind: 'saturated' }
  >;
  stop(caller: AssistantCaller, id: string): Promise<'stopped' | 'idle' | 'not_found'>;
}

export interface AssistantChatRouteDeps {
  readonly chat: AssistantChatPort | undefined;
  // Whether the tenant offers the assistant (`assistant_enabled`). Absent, it is.
  readonly offered?: ((request: AdminRequest, tenantId: string) => Promise<boolean>) | undefined;
}

// A tenant that turned the assistant off is not served new work: create and
// send answer as a path never served, while what a person already has can still
// be read and a running turn stopped.
async function offered(
  deps: AssistantChatRouteDeps,
  request: AdminRequest,
  tenantId: string,
): Promise<boolean> {
  return deps.offered === undefined || (await deps.offered(request, tenantId));
}

// What `AssistantChatRouteDeps.offered` is, from the settings the routes read.
export function tenantOffersAssistant(deps: AssistantRouteDeps): AssistantChatRouteDeps['offered'] {
  const store = deps.store;
  if (store === undefined) return undefined;
  return async (request, tenantId) => {
    const { settings } = await adminTx(deps.database, request, tenantId, (tx) =>
      readAssistantSettings({ store }, tx, tenantId),
    );
    return settings.assistant_enabled;
  };
}

function notFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
}

// A conversation is its owner's, inside the tenant the owner belongs to. A
// system-tenant administrator may reach another tenant's admin routes, but
// has no subject there to own a conversation, so the assistant is not served
// to them on it, with the answer a disabled assistant gives.
function callerOf(
  request: AdminRequest,
  principal: {
    readonly subjectId: string;
    readonly grantId?: string;
    readonly issuerTenantId: string;
  },
  tenantId: string,
): AssistantCaller | null {
  if (principal.issuerTenantId !== tenantId) return null;
  const tenantName = request.params.tenant ?? '';
  return {
    tenantId,
    tenantName,
    issuer: tenantIssuerFor(request, tenantName),
    ownerSubjectId: principal.subjectId,
    grantId: principal.grantId,
    requestId: request.id,
    ip: request.ip,
  };
}

interface Call {
  readonly chat: AssistantChatPort;
  readonly caller: AssistantCaller;
  readonly request: AdminRequest;
  readonly reply: FastifyReply;
}

// The conversation routes share what they need: the port, the caller and the
// conversation's id, or a 404 when there is no assistant.
function onConversation(
  deps: AssistantChatRouteDeps,
  run: (call: Call, id: string) => Promise<FastifyReply>,
): AdminRouteHandler {
  return async function handleConversation(request, reply, principal, tenantId) {
    const { chat } = deps;
    const id = request.params.id;
    const caller = callerOf(request, principal, tenantId);
    if (chat === undefined || id === undefined || caller === null) return notFound(request, reply);
    return run({ chat, caller, request, reply }, id);
  };
}

export function createConversationHandler(deps: AssistantChatRouteDeps): AdminRouteHandler {
  return async function handleCreateConversation(request, reply, principal, tenantId) {
    const caller = callerOf(request, principal, tenantId);
    if (deps.chat === undefined || caller === null) return notFound(request, reply);
    if (!(await offered(deps, request, tenantId))) return notFound(request, reply);
    const outcome = await deps.chat.create(caller, request.body as CreateConversationRequest);
    if (outcome.kind === 'unknown_profile') {
      return sendProblem(
        reply,
        request,
        problem(400, 'about:blank', 'Bad Request', 'the profile is not one this server offers'),
      );
    }
    return reply.code(201).send(outcome.conversation);
  };
}

export function loadConversationHandler(deps: AssistantChatRouteDeps): AdminRouteHandler {
  return onConversation(deps, async ({ chat, caller, request, reply }, id) => {
    const conversation = await chat.load(caller, id);
    return conversation === null ? notFound(request, reply) : reply.code(200).send(conversation);
  });
}

export function stopConversationHandler(deps: AssistantChatRouteDeps): AdminRouteHandler {
  return onConversation(deps, async ({ chat, caller, request, reply }, id) => {
    const outcome = await chat.stop(caller, id);
    return outcome === 'not_found'
      ? notFound(request, reply)
      : reply.code(200).send({ stopped: outcome === 'stopped' });
  });
}

// The model call is aborted when the caller's connection closes before the
// response has finished, so a closed tab stops the spend.
function abortWhenClosed(reply: FastifyReply): AbortSignal {
  const gone = new AbortController();
  reply.raw.once('close', () => {
    if (!reply.raw.writableFinished) gone.abort();
  });
  return gone.signal;
}

export function sendMessageHandler(deps: AssistantChatRouteDeps): AdminRouteHandler {
  return onConversation(deps, async ({ chat, caller, request, reply }, id) => {
    if (!(await offered(deps, request, caller.tenantId))) return notFound(request, reply);
    const body = request.body as SendMessageRequest;
    const outcome = await chat.send(caller, id, body.message, abortWhenClosed(reply));
    if (outcome.kind === 'not_found') return notFound(request, reply);
    if (outcome.kind === 'busy') {
      return sendProblem(
        reply,
        request,
        problem(409, 'about:blank', 'Conflict', 'a turn is already running in this conversation'),
      );
    }
    if (outcome.kind === 'saturated') {
      reply.header('retry-after', '1');
      return sendProblem(
        reply,
        request,
        problem(429, 'about:blank', 'Too Many Requests', 'the assistant is busy; try again'),
      );
    }
    const { response } = outcome;
    reply.code(response.status);
    response.headers.forEach((value, name) => {
      reply.header(name, value);
    });
    if (response.body === null) return reply.send();
    return reply.send(Readable.fromWeb(response.body));
  });
}
