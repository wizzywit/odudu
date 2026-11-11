import {
  meAmendProfileRequestSchema,
  meListQuerySchema,
  meNoQuerySchema,
  meRenameCredentialRequestSchema,
} from '@odudu/contracts/me';
import { isUuid, tenantAddressOf } from '@odudu/kernel';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  agentNotPermitted,
  conflict,
  invalidBody,
  invalidRequest,
  mailUnavailable,
  notFound,
  removalRefused,
  usernameNotEditable,
} from '#/service/errors';
import {
  consentsDto,
  credentialDto,
  credentialsDto,
  profileDto,
  sessionEndedDto,
  sessionsDto,
  sessionsEndedDto,
} from '#/service/wire';
import {
  admitMeRead,
  admitMeWrite,
  type AdmitMeDeps,
  type MeAdmission,
  type MeCaller,
} from '#/usecase/admit-me';
import { emailRequestOf, type EmailRoute } from '#/service/email-change';
import { acrForRemoval, requireFreshSignIn, type MeGateDeps } from '#/usecase/freshness-gate';
import {
  listConsents,
  listCredentials,
  listSessions,
  readProfile,
  type ListQuery,
  type MeReadDeps,
} from '#/usecase/reads';
import {
  amendProfile,
  endOtherSessions,
  endSession,
  removeCredential,
  renameCredential,
  requestEmailChange,
  revokeConsent,
  type MeWriteDeps,
} from '#/usecase/writes';

export interface MeDeps extends AdmitMeDeps, MeReadDeps, MeWriteDeps, MeGateDeps {}

type MeRequest = FastifyRequest<{ Params: { tenant: string } }>;

const BASE = '/tenants/:tenant/me';

const NO_AUTHENTICATOR = 'No such authenticator';

// No route names a subject: the token's own is the only one any of them acts for.
export const ME_ROUTES: readonly { readonly method: string; readonly url: string }[] = [
  ...['profile', 'credentials', 'sessions', 'consents'].map((name) => ({
    method: 'GET',
    url: `${BASE}/${name}`,
  })),
  { method: 'PATCH', url: `${BASE}/profile` },
  { method: 'DELETE', url: `${BASE}/sessions` },
  { method: 'DELETE', url: `${BASE}/sessions/:id` },
  { method: 'DELETE', url: `${BASE}/consents/:client_id` },
  { method: 'PATCH', url: `${BASE}/credentials/:id` },
  { method: 'DELETE', url: `${BASE}/credentials/:id` },
];

function respond(reply: FastifyReply, status: number, body?: object): FastifyReply {
  const sent = reply.code(status).header('cache-control', 'no-store');
  return body === undefined ? sent.send() : sent.send(body);
}

// The caller a request acts for, or the answer the door gave instead.
function callerOrAnswer(admission: MeAdmission, reply: FastifyReply): MeCaller | undefined {
  if (admission.kind === 'admitted') return admission.caller;
  if (admission.kind === 'not_found') respond(reply, 404);
  else if (admission.kind === 'agent_not_permitted') respond(reply, 403, agentNotPermitted());
  else if (admission.kind === 'unauthenticated') {
    reply.header('www-authenticate', admission.challenge);
    respond(reply, 401);
  } else {
    reply.header('www-authenticate', admission.challenge);
    respond(reply, 403);
  }
  return undefined;
}

function doorInput(deps: MeDeps, request: MeRequest) {
  return {
    authorizationHeader: request.headers.authorization,
    tenantName: request.params.tenant,
    address: tenantAddressOf(request),
    now: deps.now(),
  };
}

const admit = async (deps: MeDeps, request: MeRequest, reply: FastifyReply) =>
  callerOrAnswer(await admitMeRead(deps, doorInput(deps, request)), reply);

const admitWrite = async (deps: MeDeps, request: MeRequest, reply: FastifyReply) =>
  callerOrAnswer(await admitMeWrite(deps, doorInput(deps, request)), reply);

// Whether the sign-in behind the token is recent enough for a gated change;
// when it is not, the refusal has been sent.
async function signInIsFresh(
  deps: MeDeps,
  caller: MeCaller,
  reply: FastifyReply,
  acrValues: string | null = null,
): Promise<boolean> {
  const outcome = await requireFreshSignIn(deps, caller, acrValues);
  if (outcome.kind === 'fresh') return true;
  reply.header('www-authenticate', outcome.challenge);
  respond(reply, 401);
  return false;
}

type Read<Ok> = (
  deps: MeReadDeps,
  caller: MeCaller,
  query: ListQuery,
) => Promise<Ok | { readonly kind: 'invalid_cursor' }>;

function listRoute<Ok extends { readonly kind: 'ok' }>(
  app: FastifyInstance,
  deps: MeDeps,
  name: string,
  read: Read<Ok>,
  answer: (outcome: Ok) => object,
): void {
  app.get<{ Params: { tenant: string } }>(`${BASE}/${name}`, async (request, reply) => {
    const caller = await admit(deps, request, reply);
    if (caller === undefined) return reply;
    const query = meListQuerySchema.safeParse(request.query);
    if (!query.success) return respond(reply, 400, invalidRequest('The query is not valid'));
    const outcome = await read(deps, caller, query.data);
    if (outcome.kind === 'invalid_cursor') {
      return respond(reply, 400, invalidRequest('The cursor is not valid'));
    }
    return respond(reply, 200, answer(outcome));
  });
}

// The address is changed by a request of its own: it is answered 202 and the
// other members 200, and one answer cannot be both.
async function changeEmail(
  deps: MeDeps,
  caller: MeCaller,
  asked: Exclude<EmailRoute, { readonly kind: 'not_email' }>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (asked.kind === 'invalid') {
    return respond(reply, 400, invalidRequest(`email: ${asked.description}`));
  }
  if (!(await signInIsFresh(deps, caller, reply))) return reply;
  const outcome = await requestEmailChange(deps, caller, asked.email);
  if (outcome.kind === 'not_found') {
    return respond(reply, 404, notFound('There is no profile for this account'));
  }
  if (outcome.kind === 'mail_unavailable') return respond(reply, 503, mailUnavailable());
  return respond(reply, 202, { email_verification_sent: true });
}

function registerWrites(app: FastifyInstance, deps: MeDeps): void {
  app.patch<{ Params: { tenant: string } }>(`${BASE}/profile`, async (request, reply) => {
    const caller = await admitWrite(deps, request, reply);
    if (caller === undefined) return reply;
    const body = meAmendProfileRequestSchema.safeParse(request.body);
    if (!body.success) return respond(reply, 400, invalidBody(body.error.issues));
    const asked = emailRequestOf(body.data);
    if (asked.kind !== 'not_email') return changeEmail(deps, caller, asked, reply);
    if (body.data.username !== undefined) {
      if (!caller.usernameEditable) return respond(reply, 400, usernameNotEditable());
      if (!(await signInIsFresh(deps, caller, reply))) return reply;
    }
    const outcome = await amendProfile(deps, caller, body.data);
    if (outcome.kind === 'not_found') {
      return respond(reply, 404, notFound('There is no profile for this account'));
    }
    if (outcome.kind === 'username_taken') {
      return respond(reply, 409, conflict('That username is already in use'));
    }
    if (outcome.kind === 'invalid_value') {
      return respond(reply, 400, invalidRequest(`${outcome.field}: ${outcome.description}`));
    }
    return respond(reply, 200, profileDto(outcome.profile));
  });

  app.delete<{ Params: { tenant: string } }>(`${BASE}/sessions`, async (request, reply) => {
    const caller = await admitWrite(deps, request, reply);
    if (caller === undefined) return reply;
    if (!(await signInIsFresh(deps, caller, reply))) return reply;
    const outcome = await endOtherSessions(deps, caller);
    return respond(reply, 200, sessionsEndedDto(outcome.ended, outcome.more));
  });

  app.delete<{ Params: { tenant: string; id: string } }>(
    `${BASE}/sessions/:id`,
    async (request, reply) => {
      const caller = await admitWrite(deps, request, reply);
      if (caller === undefined) return reply;
      const outcome = await endSession(deps, caller, request.params.id);
      if (outcome.kind === 'not_found') return respond(reply, 404, notFound('No such session'));
      return respond(reply, 200, sessionEndedDto(outcome.currentSessionEnded));
    },
  );

  app.delete<{ Params: { tenant: string; client_id: string } }>(
    `${BASE}/consents/:client_id`,
    async (request, reply) => {
      const caller = await admitWrite(deps, request, reply);
      if (caller === undefined) return reply;
      if (!(await signInIsFresh(deps, caller, reply))) return reply;
      const outcome = await revokeConsent(deps, caller, request.params.client_id);
      if (outcome.kind === 'not_found') return respond(reply, 404, notFound('No such consent'));
      return respond(reply, 204);
    },
  );

  app.patch<{ Params: { tenant: string; id: string } }>(
    `${BASE}/credentials/:id`,
    async (request, reply) => {
      const caller = await admitWrite(deps, request, reply);
      if (caller === undefined) return reply;
      const body = meRenameCredentialRequestSchema.safeParse(request.body);
      if (!body.success) return respond(reply, 400, invalidBody(body.error.issues));
      const outcome = await renameCredential(deps, caller, request.params.id, body.data.label);
      if (outcome.kind === 'not_found') {
        return respond(reply, 404, notFound(NO_AUTHENTICATOR));
      }
      return respond(reply, 200, credentialDto(outcome.credential));
    },
  );

  app.delete<{ Params: { tenant: string; id: string } }>(
    `${BASE}/credentials/:id`,
    async (request, reply) => {
      const caller = await admitWrite(deps, request, reply);
      if (caller === undefined) return reply;
      if (!isUuid(request.params.id)) return respond(reply, 404, notFound(NO_AUTHENTICATOR));
      const acr = await acrForRemoval(deps, caller);
      if (!(await signInIsFresh(deps, caller, reply, acr))) return reply;
      const outcome = await removeCredential(deps, caller, request.params.id);
      if (outcome.kind === 'not_found') return respond(reply, 404, notFound(NO_AUTHENTICATOR));
      if (outcome.kind === 'refused') return respond(reply, 409, removalRefused(outcome.code));
      return respond(reply, 204);
    },
  );
}

export function registerMeRoutes(app: FastifyInstance, deps: MeDeps): void {
  registerWrites(app, deps);
  app.get<{ Params: { tenant: string } }>(`${BASE}/profile`, async (request, reply) => {
    const caller = await admit(deps, request, reply);
    if (caller === undefined) return reply;
    if (!meNoQuerySchema.safeParse(request.query).success) {
      return respond(reply, 400, invalidRequest('The query is not valid'));
    }
    const outcome = await readProfile(deps, caller);
    if (outcome.kind === 'not_found') {
      return respond(reply, 404, notFound('There is no profile for this account'));
    }
    return respond(reply, 200, profileDto(outcome.profile));
  });
  listRoute(app, deps, 'credentials', listCredentials, (o) =>
    credentialsDto(o.items, o.next, o.recoveryCodesLeft),
  );
  listRoute(app, deps, 'sessions', listSessions, (o) => sessionsDto(o.items, o.next));
  listRoute(app, deps, 'consents', listConsents, (o) => consentsDto(o.items, o.next));
}
