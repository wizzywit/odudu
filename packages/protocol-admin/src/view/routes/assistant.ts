import {
  ASSISTANT_SETTING_DEFAULTS,
  listAssistantConversationsQuerySchema,
  putAssistantSettingsRequestSchema,
  type AssistantApprovalCard,
  type AssistantConversation,
  type AssistantConversationExport,
  type AssistantConversationSummary,
  type AssistantMode,
  type AssistantResumedConversation,
  type ListAssistantConversationsResponse,
  type SetConversationArchivedRequest,
  type SetConversationArchivedResponse,
  type AssistantSettings,
  type AssistantStatus,
  type CreateConversationRequest,
  type DecideApprovalRequest,
  type SendMessageRequest,
  type SetConversationModeRequest,
} from '@odudu/contracts/admin';
import { type Database } from '@odudu/db';
import { isSystemTenantId } from '@odudu/domain-tenant';
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
import {
  coerceLimit,
  decodeCursor,
  encodeCursor,
  filterDigest,
  nextPageUrl,
} from '#/service/cursor';
import { cursorProblem, ifMatchStale, problem, queryProblem, sendProblem } from '#/view/problem';
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
  // The tenant the path names when a system administrator uses the assistant in
  // a tenant other than their own; the fields above stay the administrator's.
  readonly target?: { readonly id: string; readonly name: string };
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
    | { kind: 'created'; conversation: AssistantConversation }
    | { kind: 'unknown_profile' }
    | { kind: 'access_refused'; reason: string }
  >;
  load(caller: AssistantCaller, id: string): Promise<AssistantResumedConversation | null>;
  /** One page of the caller's own conversations; `after` is where the last page ended. */
  list(
    caller: AssistantCaller,
    input: { archived: boolean; after: string | undefined; limit: number },
  ): Promise<
    | { kind: 'ok'; items: AssistantConversationSummary[]; next: string | null }
    | { kind: 'invalid_position' }
  >;
  last(caller: AssistantCaller): Promise<AssistantResumedConversation | null>;
  setArchived(
    caller: AssistantCaller,
    id: string,
    archived: boolean,
  ): Promise<{ kind: 'set'; archivedAt: Date | null } | { kind: 'not_found' }>;
  remove(
    caller: AssistantCaller,
    id: string,
  ): Promise<
    | { kind: 'deleted' }
    | { kind: 'not_found' }
    | { kind: 'held' }
    | { kind: 'busy' }
    | { kind: 'unavailable' }
  >;
  export(
    caller: AssistantCaller,
    id: string,
    format: 'json' | 'markdown',
  ): Promise<
    | { kind: 'ok'; document: AssistantConversationExport; markdown: string | undefined }
    | { kind: 'not_found' }
    | { kind: 'unavailable' }
  >;
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
    | { kind: 'limited'; retryAfterSeconds: number }
    | { kind: 'ended'; reason: EndedReason }
  >;
  stop(caller: AssistantCaller, id: string): Promise<'stopped' | 'idle' | 'not_found'>;
  approvals(caller: AssistantCaller, id: string): Promise<AssistantApprovalCard[] | null>;
  answerApproval(
    caller: AssistantCaller,
    id: string,
    approvalId: string,
    approve: boolean,
  ): Promise<
    | { kind: 'decided'; state: 'approved' | 'denied' }
    | { kind: 'not_found' }
    | { kind: 'not_pending' }
  >;
  resume(
    caller: AssistantCaller,
    id: string,
    signal: AbortSignal,
  ): Promise<
    | { kind: 'stream'; response: Response }
    | { kind: 'not_found' }
    | { kind: 'busy' }
    | { kind: 'saturated' }
    | { kind: 'limited'; retryAfterSeconds: number }
    | { kind: 'ended'; reason: EndedReason }
    | { kind: 'waiting' }
    | { kind: 'nothing_waiting' }
  >;
  setMode(
    caller: AssistantCaller,
    id: string,
    mode: AssistantMode,
  ): Promise<
    { kind: 'set'; mode: AssistantMode } | { kind: 'not_found' } | { kind: 'not_offered' }
  >;
}

export interface AssistantChatRouteDeps {
  readonly chat: AssistantChatPort | undefined;
  // Signs the position a list resumes from, so a cursor is not one a caller wrote.
  readonly cursorKey: Uint8Array;
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

// A conversation is its owner's and belongs to the tenant the owner belongs
// to. A system administrator may use it for another tenant: the path then
// names that tenant, which is recorded on the caller as the target, and the
// conversation is bound to it when created and served at no other path. Any
// other principal at another tenant's path, and any agent token, is served as a
// path that never existed.
function callerOf(
  request: AdminRequest,
  principal: {
    readonly subjectId: string;
    readonly grantId?: string;
    readonly issuerTenantId: string;
    readonly issuerTenantName: string;
    readonly agent?: unknown;
  },
  tenantId: string,
): AssistantCaller | null {
  const tenantName = request.params.tenant ?? '';
  const own = principal.issuerTenantId === tenantId;
  if (!own && (principal.agent !== undefined || !isSystemTenantId(principal.issuerTenantId))) {
    return null;
  }
  const homeName = own ? tenantName : principal.issuerTenantName;
  return {
    tenantId: principal.issuerTenantId,
    tenantName: homeName,
    issuer: tenantIssuerFor(request, homeName),
    ownerSubjectId: principal.subjectId,
    grantId: principal.grantId,
    requestId: request.id,
    ip: request.ip,
    ...(own ? {} : { target: { id: tenantId, name: tenantName } }),
  };
}

// Whether every tenant the conversation involves offers the assistant: the path
// tenant, and the administrator's own when it differs.
async function offeredFor(
  deps: AssistantChatRouteDeps,
  request: AdminRequest,
  caller: AssistantCaller,
): Promise<boolean> {
  if (!(await offered(deps, request, caller.target?.id ?? caller.tenantId))) return false;
  return caller.target === undefined || (await offered(deps, request, caller.tenantId));
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
    if (!(await offeredFor(deps, request, caller))) return notFound(request, reply);
    const outcome = await deps.chat.create(caller, request.body as CreateConversationRequest);
    if (outcome.kind === 'unknown_profile') {
      return sendProblem(
        reply,
        request,
        problem(400, 'about:blank', 'Bad Request', 'the profile is not one this server offers'),
      );
    }
    if (outcome.kind === 'access_refused') {
      return sendProblem(
        reply,
        request,
        problem(403, 'about:blank', 'Forbidden', 'the assistant cannot act for this sign-in'),
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

// Why a conversation could not be given a grant under the caller's sign-in.
type EndedReason = 'archived' | 'revoked' | 'not_allowed';

// What a conversation that could not be given a grant answers: its own problem
// type for each reason a person acts on differently.
function endedProblem(reason: EndedReason) {
  if (reason === 'archived') {
    return problem(
      409,
      'about:blank#conversation-archived',
      'Conflict',
      'the conversation is hidden from your list; restore it, then send the message again',
    );
  }
  if (reason === 'revoked') {
    return problem(
      409,
      'about:blank#conversation-ended',
      'Conflict',
      'the sign-in this conversation acted under was ended for a reason other than signing out, so it is not carried on; start a new conversation',
    );
  }
  return problem(
    409,
    'about:blank#conversation-access-refused',
    'Conflict',
    'the sign-in you hold now may not carry this conversation on: the assistant, your capabilities or the tenant it acts in no longer allow it',
  );
}

// What a refused turn answers, for a message and a resume alike.
function refusedTurn(
  outcome:
    | { kind: 'not_found' }
    | { kind: 'busy' }
    | { kind: 'saturated' }
    | { kind: 'limited'; retryAfterSeconds: number }
    | { kind: 'ended'; reason: EndedReason },
  request: AdminRequest,
  reply: FastifyReply,
): FastifyReply {
  if (outcome.kind === 'not_found') return notFound(request, reply);
  if (outcome.kind === 'ended') {
    return sendProblem(reply, request, endedProblem(outcome.reason));
  }
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
  reply.header('retry-after', String(outcome.retryAfterSeconds));
  return sendProblem(
    reply,
    request,
    problem(
      429,
      'about:blank',
      'Too Many Requests',
      `the tenant has as many answers in progress as its settings allow; try again in ${String(outcome.retryAfterSeconds)} seconds`,
    ),
  );
}

function sendStream(reply: FastifyReply, response: Response): FastifyReply {
  reply.code(response.status);
  response.headers.forEach((value, name) => {
    reply.header(name, value);
  });
  if (response.body === null) return reply.send();
  return reply.send(Readable.from(chunksOf(response.body)));
}

export function sendMessageHandler(deps: AssistantChatRouteDeps): AdminRouteHandler {
  return onConversation(deps, async ({ chat, caller, request, reply }, id) => {
    if (!(await offeredFor(deps, request, caller))) return notFound(request, reply);
    const body = request.body as SendMessageRequest;
    const outcome = await chat.send(caller, id, body.message, abortWhenClosed(reply));
    if (outcome.kind !== 'stream') return refusedTurn(outcome, request, reply);
    return sendStream(reply, outcome.response);
  });
}

// Carries the conversation on after the person decided a change, streaming the
// rest of the answer as a message's reply does.
export function resumeConversationHandler(deps: AssistantChatRouteDeps): AdminRouteHandler {
  return onConversation(deps, async ({ chat, caller, request, reply }, id) => {
    if (!(await offeredFor(deps, request, caller))) return notFound(request, reply);
    const outcome = await chat.resume(caller, id, abortWhenClosed(reply));
    if (outcome.kind === 'stream') return sendStream(reply, outcome.response);
    if (outcome.kind === 'waiting') {
      return sendProblem(
        reply,
        request,
        problem(409, 'about:blank', 'Conflict', 'a change still waits for your decision'),
      );
    }
    if (outcome.kind === 'nothing_waiting') {
      return sendProblem(
        reply,
        request,
        problem(409, 'about:blank', 'Conflict', 'no decision is waiting to be carried on'),
      );
    }
    return refusedTurn(outcome, request, reply);
  });
}

export function listApprovalsHandler(deps: AssistantChatRouteDeps): AdminRouteHandler {
  return onConversation(deps, async ({ chat, caller, request, reply }, id) => {
    const items = await chat.approvals(caller, id);
    return items === null ? notFound(request, reply) : reply.code(200).send({ items });
  });
}

// The decision of the person the conversation belongs to. The door has already
// refused every token that acts for an agent, because no agent write names this
// route; the port refuses a token that is not a console sign-in, and an approval
// that is not this conversation's or this person's answers as one that is not there.
export function decideApprovalHandler(deps: AssistantChatRouteDeps): AdminRouteHandler {
  return onConversation(deps, async ({ chat, caller, request, reply }, id) => {
    const approvalId = request.params.approvalId;
    if (approvalId === undefined) return notFound(request, reply);
    const body = request.body as DecideApprovalRequest;
    const outcome = await chat.answerApproval(caller, id, approvalId, body.approve);
    if (outcome.kind === 'not_found') return notFound(request, reply);
    if (outcome.kind === 'not_pending') {
      return sendProblem(
        reply,
        request,
        problem(409, 'about:blank', 'Conflict', 'this change was already decided or has expired'),
      );
    }
    return reply.code(200).send({ state: outcome.state });
  });
}

export function setConversationModeHandler(deps: AssistantChatRouteDeps): AdminRouteHandler {
  return onConversation(deps, async ({ chat, caller, request, reply }, id) => {
    const body = request.body as SetConversationModeRequest;
    const outcome = await chat.setMode(caller, id, body.mode);
    if (outcome.kind === 'not_found') return notFound(request, reply);
    if (outcome.kind === 'not_offered') {
      return sendProblem(
        reply,
        request,
        problem(409, 'about:blank', 'Conflict', 'this mode is not offered here'),
      );
    }
    return reply.code(200).send({ mode: outcome.mode });
  });
}

// Pulls the body a chunk at a time and cancels it when the reply stops reading
// or closes, so closing the connection reaches the model call. Written over
// the reader because the web stream types of the DOM library and node's differ.
async function* chunksOf(body: NonNullable<Response['body']>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return;
      yield next.value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

const LIST_COLLECTION = 'assistant-conversations';

// A cursor is bound to the tenant of the path, the list it walks and the person
// it is for, so one person's cannot be replayed as another's.
function listDigest(archived: boolean, caller: AssistantCaller): string {
  return filterDigest({ archived: String(archived), person: caller.ownerSubjectId });
}

export function listConversationsHandler(deps: AssistantChatRouteDeps): AdminRouteHandler {
  return async function handleList(request, reply, principal, tenantId) {
    const caller = callerOf(request, principal, tenantId);
    if (deps.chat === undefined || caller === null) return notFound(request, reply);
    const parsed = listAssistantConversationsQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendProblem(reply, request, queryProblem(parsed.error));
    const archived = parsed.data.archived === 'true';
    const limit = coerceLimit(
      parsed.data.limit === undefined ? undefined : String(parsed.data.limit),
    );
    let after: string | undefined;
    if (parsed.data.cursor !== undefined) {
      const decoded = decodeCursor(
        deps.cursorKey,
        LIST_COLLECTION,
        tenantId,
        listDigest(archived, caller),
        parsed.data.cursor,
      );
      if (decoded.kind === 'invalid') return sendProblem(reply, request, cursorProblem());
      after = decoded.after;
    }
    const page = await deps.chat.list(caller, { archived, after, limit });
    if (page.kind === 'invalid_position') return sendProblem(reply, request, cursorProblem());
    const body: ListAssistantConversationsResponse = { items: page.items };
    if (page.next === null) return reply.code(200).send(body);
    const next = encodeCursor(deps.cursorKey, {
      after: page.next,
      collection: LIST_COLLECTION,
      tenantId,
      filters: listDigest(archived, caller),
    });
    const url = nextPageUrl(
      `/admin/tenants/${request.params.tenant ?? ''}/assistant/conversations`,
      {
        archived: parsed.data.archived,
        limit,
        cursor: next,
      },
    );
    reply.header('link', `<${url}>; rel="next"`);
    return reply.code(200).send({ ...body, next });
  };
}

export function lastConversationHandler(deps: AssistantChatRouteDeps): AdminRouteHandler {
  return async function handleLast(request, reply, principal, tenantId) {
    const caller = callerOf(request, principal, tenantId);
    if (deps.chat === undefined || caller === null) return notFound(request, reply);
    return reply.code(200).send({ conversation: await deps.chat.last(caller) });
  };
}

export function setConversationArchivedHandler(deps: AssistantChatRouteDeps): AdminRouteHandler {
  return onConversation(deps, async ({ chat, caller, request, reply }, id) => {
    const body = request.body as SetConversationArchivedRequest;
    const outcome = await chat.setArchived(caller, id, body.archived);
    if (outcome.kind === 'not_found') return notFound(request, reply);
    const answer: SetConversationArchivedResponse = {
      archived: outcome.archivedAt !== null,
      archived_at: outcome.archivedAt?.toISOString() ?? null,
    };
    return reply.code(200).send(answer);
  });
}

// Deleting is the owner's, from the conversation's own path, and works while the
// assistant is switched off: a person may always remove what they wrote.
export function deleteConversationHandler(deps: AssistantChatRouteDeps): AdminRouteHandler {
  return onConversation(deps, async ({ chat, caller, request, reply }, id) => {
    const outcome = await chat.remove(caller, id);
    if (outcome.kind === 'not_found' || outcome.kind === 'unavailable') {
      return notFound(request, reply);
    }
    if (outcome.kind === 'held') {
      return sendProblem(
        reply,
        request,
        problem(
          409,
          'about:blank#conversation-reported',
          'Conflict',
          'this conversation was reported and is kept for review; you can archive it but not delete it',
        ),
      );
    }
    if (outcome.kind === 'busy') {
      return sendProblem(
        reply,
        request,
        problem(
          409,
          'about:blank#conversation-busy',
          'Conflict',
          'an answer is still running; stop it first',
        ),
      );
    }
    return reply.code(204).send();
  });
}

function exportHandler(
  deps: AssistantChatRouteDeps,
  format: 'json' | 'markdown',
): AdminRouteHandler {
  return onConversation(deps, async ({ chat, caller, request, reply }, id) => {
    const outcome = await chat.export(caller, id, format);
    if (outcome.kind !== 'ok') return notFound(request, reply);
    reply.header('cache-control', 'no-store');
    if (format === 'markdown' && outcome.markdown !== undefined) {
      return reply
        .header('content-disposition', `attachment; filename="conversation-${id}.md"`)
        .type('text/markdown; charset=utf-8')
        .code(200)
        .send(outcome.markdown);
    }
    return reply
      .header('content-disposition', `attachment; filename="conversation-${id}.json"`)
      .code(200)
      .send(outcome.document);
  });
}

export function exportConversationHandler(deps: AssistantChatRouteDeps): AdminRouteHandler {
  return exportHandler(deps, 'json');
}

export function exportConversationMarkdownHandler(deps: AssistantChatRouteDeps): AdminRouteHandler {
  return exportHandler(deps, 'markdown');
}
