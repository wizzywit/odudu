import {
  type AssistantConversation,
  type AssistantStatus,
  type CreateConversationRequest,
  type SendMessageRequest,
} from '@odudu/contracts/admin';
import { tenantIssuerFor } from '@odudu/protocol-oidc';
import { type FastifyReply, type FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { problem, sendProblem } from '#/view/problem';
import { type AdminRequest, type AdminRouteHandler } from '#/view/routes/router';

export interface AssistantRouteDeps {
  readonly status: () => AssistantStatus;
}

export function assistantStatusHandler(deps: AssistantRouteDeps): AdminRouteHandler {
  return function handleAssistantStatus(_request, reply): FastifyReply {
    return reply.code(200).send(deps.status());
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
}

function notFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendProblem(reply, request, problem(404, 'about:blank', 'Not Found'));
}

function callerOf(
  request: AdminRequest,
  principal: { readonly subjectId: string; readonly grantId?: string },
  tenantId: string,
): AssistantCaller {
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
    if (chat === undefined || id === undefined) return notFound(request, reply);
    return run({ chat, caller: callerOf(request, principal, tenantId), request, reply }, id);
  };
}

export function createConversationHandler(deps: AssistantChatRouteDeps): AdminRouteHandler {
  return async function handleCreateConversation(request, reply, principal, tenantId) {
    if (deps.chat === undefined) return notFound(request, reply);
    const outcome = await deps.chat.create(
      callerOf(request, principal, tenantId),
      request.body as CreateConversationRequest,
    );
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
