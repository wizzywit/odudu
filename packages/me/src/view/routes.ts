import { meListQuerySchema } from '@odudu/contracts/me';
import { tenantAddressOf } from '@odudu/kernel';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { invalidRequest, notFound } from '#/service/errors';
import { consentsDto, credentialsDto, profileDto, sessionsDto } from '#/service/wire';
import { admitMeRead, type AdmitMeReadDeps, type MeCaller } from '#/usecase/admit-me-read';
import {
  listConsents,
  listCredentials,
  listSessions,
  readProfile,
  type ListQuery,
  type MeReadDeps,
} from '#/usecase/reads';

export interface MeDeps extends AdmitMeReadDeps, MeReadDeps {}

type MeRequest = FastifyRequest<{ Params: { tenant: string } }>;

const BASE = '/tenants/:tenant/me';

// No route names a subject: the token's own is the only one any of them acts for.
export const ME_ROUTES = ['profile', 'credentials', 'sessions', 'consents'].map((name) => ({
  method: 'GET',
  url: `${BASE}/${name}`,
}));

function respond(reply: FastifyReply, status: number, body?: object): FastifyReply {
  const sent = reply.code(status).header('cache-control', 'no-store');
  return body === undefined ? sent.send() : sent.send(body);
}

// The caller a request acts for, or the answer the door gave instead.
async function admit(
  deps: MeDeps,
  request: MeRequest,
  reply: FastifyReply,
): Promise<MeCaller | undefined> {
  const admission = await admitMeRead(deps, {
    authorizationHeader: request.headers.authorization,
    tenantName: request.params.tenant,
    address: tenantAddressOf(request),
    now: deps.now(),
  });
  if (admission.kind === 'admitted') return admission.caller;
  if (admission.kind === 'not_found') respond(reply, 404);
  else if (admission.kind === 'unauthenticated') {
    reply.header('www-authenticate', admission.challenge);
    respond(reply, 401);
  } else {
    reply.header('www-authenticate', admission.challenge);
    respond(reply, 403);
  }
  return undefined;
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

export function registerMeRoutes(app: FastifyInstance, deps: MeDeps): void {
  app.get<{ Params: { tenant: string } }>(`${BASE}/profile`, async (request, reply) => {
    const caller = await admit(deps, request, reply);
    if (caller === undefined) return reply;
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
