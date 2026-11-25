import {
  meAmendProfileRequestSchema,
  meConsentsResponseSchema,
  meCreateDelegationRequestSchema,
  meCredentialSchema,
  meCredentialsResponseSchema,
  meDelegationSchema,
  meDelegationsResponseSchema,
  meEmailVerificationSentSchema,
  meListQuerySchema,
  meNoQuerySchema,
  meProfileSchema,
  meRenameCredentialRequestSchema,
  meSessionEndedSchema,
  meSessionsEndedSchema,
  meSessionsResponseSchema,
} from '@odudu/contracts/me';
import { isUuid, tenantAddressOf } from '@odudu/kernel';
import { normalizeOrigin } from '@odudu/protocol-oidc';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  agentNotPermitted,
  conflict,
  delegationLimit,
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
  delegationDto,
  delegationsDto,
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
import { invalidToken } from '#/service/challenge';
import { meAnswerHeaders, mePreflightHeaders } from '#/service/cors';
import { createDelegation, listDelegations, revokeDelegation } from '#/usecase/delegations';
import { emailRequestOf, type EmailRoute } from '#/service/email-change';
import {
  acrForRemoval,
  requireFreshSignIn,
  requireLiveSession,
  type MeGateDeps,
} from '#/usecase/freshness-gate';
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

export interface MeCors {
  // The browser origins the client a token was issued to allows, empty for a
  // client that is unknown or disabled.
  clientOrigins(tenantId: string, clientId: string): Promise<ReadonlySet<string>>;
  // Whether an enabled client of the tenant allows this normalised origin.
  originAllowed(tenantId: string, origin: string): Promise<boolean>;
}

export interface MeDeps extends AdmitMeDeps, MeReadDeps, MeWriteDeps, MeGateDeps {
  readonly cors: MeCors;
}

type MeRequest = FastifyRequest<{ Params: { tenant: string } }>;

const BASE = '/tenants/:tenant/me';

const NO_AUTHENTICATOR = 'No such authenticator';
const NO_DELEGATION = 'No such delegation';

export interface MeRoute {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly url: string;
  readonly summary: string;
  readonly scope: 'me:read' | 'me:write';
  // The path members other than the tenant, which every route takes.
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  readonly body?: z.ZodType;
  // A schema for a body, 'empty' for none, and 'error' for the shared answer
  // the document gives that status.
  readonly responses: Readonly<Record<number, z.ZodType | 'error' | 'empty'>>;
}

const idParams = z.object({
  id: z
    .uuid()
    .describe('The identifier of the session, credential or delegation, as listed in its `id`.'),
});

// What any route may answer before it reads its own input: a tenant that is
// unknown or disabled is a 404, and a token that is missing or short a 401 or 403.
const REFUSED = { 401: 'error', 403: 'error', 404: 'error', 429: 'error' } as const;

// One source for what a route accepts and answers: the handlers validate with
// these members and the OpenAPI document is generated from them.
const PROFILE_GET = {
  method: 'GET',
  url: `${BASE}/profile`,
  summary: 'The signed-in person’s own profile.',
  scope: 'me:read',
  query: meNoQuerySchema,
  responses: { 200: meProfileSchema, 400: 'error', ...REFUSED },
} as const satisfies MeRoute;

const CREDENTIALS_GET = {
  method: 'GET',
  url: `${BASE}/credentials`,
  summary: 'A page of the person’s own ways to sign in.',
  scope: 'me:read',
  query: meListQuerySchema,
  responses: { 200: meCredentialsResponseSchema, 400: 'error', ...REFUSED },
} as const satisfies MeRoute;

const SESSIONS_GET = {
  method: 'GET',
  url: `${BASE}/sessions`,
  summary: 'A page of the person’s own live sessions.',
  scope: 'me:read',
  query: meListQuerySchema,
  responses: { 200: meSessionsResponseSchema, 400: 'error', ...REFUSED },
} as const satisfies MeRoute;

const CONSENTS_GET = {
  method: 'GET',
  url: `${BASE}/consents`,
  summary: 'A page of the person’s own consents.',
  scope: 'me:read',
  query: meListQuerySchema,
  responses: { 200: meConsentsResponseSchema, 400: 'error', ...REFUSED },
} as const satisfies MeRoute;

const PROFILE_PATCH = {
  method: 'PATCH',
  url: `${BASE}/profile`,
  summary: 'Amends the person’s own profile; an email is changed by a mailed link.',
  scope: 'me:write',
  body: meAmendProfileRequestSchema,
  responses: {
    200: meProfileSchema,
    202: meEmailVerificationSentSchema,
    400: 'error',
    ...REFUSED,
    409: 'error',
    503: 'error',
  },
} as const satisfies MeRoute;

const SESSIONS_DELETE = {
  method: 'DELETE',
  url: `${BASE}/sessions`,
  summary: 'Ends the person’s other sessions, a bounded number at a time.',
  scope: 'me:write',
  responses: { 200: meSessionsEndedSchema, ...REFUSED },
} as const satisfies MeRoute;

const SESSION_DELETE = {
  method: 'DELETE',
  url: `${BASE}/sessions/:id`,
  summary: 'Ends one of the person’s own sessions.',
  scope: 'me:write',
  params: idParams,
  responses: { 200: meSessionEndedSchema, ...REFUSED },
} as const satisfies MeRoute;

const CONSENT_DELETE = {
  method: 'DELETE',
  url: `${BASE}/consents/:client_id`,
  summary: 'Withdraws the person’s consent to one client.',
  scope: 'me:write',
  params: z.object({
    client_id: z
      .string()
      .describe('The `client_id` of the application whose consent to withdraw, as listed.'),
  }),
  responses: { 204: 'empty', ...REFUSED },
} as const satisfies MeRoute;

const CREDENTIAL_PATCH = {
  method: 'PATCH',
  url: `${BASE}/credentials/:id`,
  summary: 'Renames one of the person’s own ways to sign in.',
  scope: 'me:write',
  params: idParams,
  body: meRenameCredentialRequestSchema,
  responses: { 200: meCredentialSchema, 400: 'error', ...REFUSED },
} as const satisfies MeRoute;

const CREDENTIAL_DELETE = {
  method: 'DELETE',
  url: `${BASE}/credentials/:id`,
  summary: 'Removes one of the person’s own ways to sign in.',
  scope: 'me:write',
  params: idParams,
  responses: { 204: 'empty', ...REFUSED, 409: 'error' },
} as const satisfies MeRoute;

const DELEGATIONS_GET = {
  method: 'GET',
  url: `${BASE}/delegations`,
  summary: 'The person’s own live delegations to agent clients.',
  scope: 'me:read',
  query: meNoQuerySchema,
  responses: { 200: meDelegationsResponseSchema, 400: 'error', ...REFUSED },
} as const satisfies MeRoute;

const DELEGATIONS_POST = {
  method: 'POST',
  url: `${BASE}/delegations`,
  summary: 'Lets an agent client act for the person, within a scope ceiling and for a time.',
  scope: 'me:write',
  body: meCreateDelegationRequestSchema,
  responses: { 201: meDelegationSchema, 400: 'error', ...REFUSED, 409: 'error' },
} as const satisfies MeRoute;

const DELEGATION_DELETE = {
  method: 'DELETE',
  url: `${BASE}/delegations/:id`,
  summary: 'Withdraws one of the person’s own delegations.',
  scope: 'me:write',
  params: idParams,
  responses: { 204: 'empty', ...REFUSED },
} as const satisfies MeRoute;

// No route names a subject: the token's own is the only one any of them acts for.
export const ME_ROUTES: readonly MeRoute[] = [
  PROFILE_GET,
  CREDENTIALS_GET,
  SESSIONS_GET,
  CONSENTS_GET,
  DELEGATIONS_GET,
  PROFILE_PATCH,
  SESSIONS_DELETE,
  SESSION_DELETE,
  CONSENT_DELETE,
  CREDENTIAL_PATCH,
  CREDENTIAL_DELETE,
  DELEGATIONS_POST,
  DELEGATION_DELETE,
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

// A browser reads the answer only where the client the token was issued to
// allows its origin. `Vary` is set for any request that names one, allowed or
// not, so a shared cache never serves one origin's answer to another; what is
// not an admitted caller has no client to ask.
async function allowOrigin(
  deps: MeDeps,
  request: MeRequest,
  reply: FastifyReply,
  caller: MeCaller | undefined,
): Promise<MeCaller | undefined> {
  const origin = request.headers.origin;
  if (caller === undefined || origin === undefined) return caller;
  const allowed = await deps.cors.clientOrigins(caller.tenantId, caller.clientId);
  reply.headers(meAnswerHeaders(origin, allowed));
  return caller;
}

// A refusal before there is a caller, a tenant's own among them, is read by a
// script only if it carries the origin too. The token cannot say which client
// to ask, so the origin is judged as a preflight judges it: allowed when some
// enabled client of the tenant lists it, and never for a tenant that is not
// there.
export async function meRefusalHeaders(
  deps: MeDeps,
  tenantName: string,
  origin: string | undefined,
): Promise<Record<string, string>> {
  if (origin === undefined) return {};
  const normalized = normalizeOrigin(origin);
  try {
    const tenant = await deps.findTenant(tenantName);
    const allowed =
      tenant?.enabled === true &&
      normalized !== null &&
      (await deps.cors.originAllowed(tenant.id, normalized))
        ? new Set([normalized])
        : new Set<string>();
    return meAnswerHeaders(origin, allowed);
  } catch (error) {
    // The refusal is the answer; failing to read an allowlist for it must not
    // replace it with a 500, and an origin that cannot be judged is not allowed.
    deps.logger.warn({ err: error }, 'me: origin allowlist unreadable for a refusal');
    return meAnswerHeaders(origin, new Set<string>());
  }
}

async function admitted(
  deps: MeDeps,
  request: MeRequest,
  reply: FastifyReply,
  admission: MeAdmission,
): Promise<MeCaller | undefined> {
  if (admission.kind !== 'admitted') {
    reply.headers(await meRefusalHeaders(deps, request.params.tenant, request.headers.origin));
    return callerOrAnswer(admission, reply);
  }
  if (request.headers.origin !== undefined) reply.header('vary', 'Origin');
  return allowOrigin(deps, request, reply, callerOrAnswer(admission, reply));
}

const admit = async (deps: MeDeps, request: MeRequest, reply: FastifyReply) =>
  admitted(deps, request, reply, await admitMeRead(deps, doorInput(deps, request)));

const admitWrite = async (deps: MeDeps, request: MeRequest, reply: FastifyReply) =>
  admitted(deps, request, reply, await admitMeWrite(deps, doorInput(deps, request)));

// A preflight carries no token, so the only allowlist at that moment is the
// tenant's union of what its enabled clients allow.
function registerPreflight(app: FastifyInstance, deps: MeDeps): void {
  app.options<{ Params: { tenant: string } }>(`${BASE}/*`, async (request, reply) => {
    reply.header('vary', 'Origin');
    const tenant = await deps.findTenant(request.params.tenant);
    const origin = request.headers.origin;
    const normalized = origin === undefined ? null : normalizeOrigin(origin);
    if (tenant?.enabled === true && normalized !== null) {
      if (await deps.cors.originAllowed(tenant.id, normalized)) {
        reply.headers(mePreflightHeaders(normalized));
      }
    }
    return reply.code(204).send();
  });
}

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

// Whether the session behind the token still stands, for a change that needs
// no recent sign-in; when it does not, the refusal has been sent.
async function sessionIsLive(
  deps: MeDeps,
  caller: MeCaller,
  reply: FastifyReply,
): Promise<boolean> {
  if (await requireLiveSession(deps, caller)) return true;
  reply.header('www-authenticate', invalidToken());
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
  route: { readonly url: string; readonly query: typeof meListQuerySchema },
  read: Read<Ok>,
  answer: (outcome: Ok) => object,
): void {
  app.get<{ Params: { tenant: string } }>(route.url, async (request, reply) => {
    const caller = await admit(deps, request, reply);
    if (caller === undefined) return reply;
    const query = route.query.safeParse(request.query);
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
  app.patch<{ Params: { tenant: string } }>(PROFILE_PATCH.url, async (request, reply) => {
    const caller = await admitWrite(deps, request, reply);
    if (caller === undefined) return reply;
    const body = PROFILE_PATCH.body.safeParse(request.body);
    if (!body.success) return respond(reply, 400, invalidBody(body.error.issues));
    const asked = emailRequestOf(body.data);
    if (asked.kind !== 'not_email') return changeEmail(deps, caller, asked, reply);
    if (body.data.username !== undefined) {
      if (!caller.usernameEditable) return respond(reply, 400, usernameNotEditable());
      if (!(await signInIsFresh(deps, caller, reply))) return reply;
    } else if (!(await sessionIsLive(deps, caller, reply))) return reply;
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

  app.delete<{ Params: { tenant: string } }>(SESSIONS_DELETE.url, async (request, reply) => {
    const caller = await admitWrite(deps, request, reply);
    if (caller === undefined) return reply;
    if (!(await signInIsFresh(deps, caller, reply))) return reply;
    const outcome = await endOtherSessions(deps, caller);
    return respond(reply, 200, sessionsEndedDto(outcome.ended, outcome.more));
  });

  app.delete<{ Params: { tenant: string; id: string } }>(
    SESSION_DELETE.url,
    async (request, reply) => {
      if (!isUuid(request.params.id)) return respond(reply, 404, notFound('No such session'));
      const caller = await admitWrite(deps, request, reply);
      if (caller === undefined) return reply;
      if (!(await sessionIsLive(deps, caller, reply))) return reply;
      const outcome = await endSession(deps, caller, request.params.id);
      if (outcome.kind === 'not_found') return respond(reply, 404, notFound('No such session'));
      return respond(reply, 200, sessionEndedDto(outcome.currentSessionEnded));
    },
  );

  app.delete<{ Params: { tenant: string; client_id: string } }>(
    CONSENT_DELETE.url,
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
    CREDENTIAL_PATCH.url,
    async (request, reply) => {
      if (!isUuid(request.params.id)) return respond(reply, 404, notFound(NO_AUTHENTICATOR));
      const caller = await admitWrite(deps, request, reply);
      if (caller === undefined) return reply;
      if (!(await sessionIsLive(deps, caller, reply))) return reply;
      const body = CREDENTIAL_PATCH.body.safeParse(request.body);
      if (!body.success) return respond(reply, 400, invalidBody(body.error.issues));
      const outcome = await renameCredential(deps, caller, request.params.id, body.data.label);
      if (outcome.kind === 'not_found') {
        return respond(reply, 404, notFound(NO_AUTHENTICATOR));
      }
      return respond(reply, 200, credentialDto(outcome.credential));
    },
  );

  app.delete<{ Params: { tenant: string; id: string } }>(
    CREDENTIAL_DELETE.url,
    async (request, reply) => {
      if (!isUuid(request.params.id)) return respond(reply, 404, notFound(NO_AUTHENTICATOR));
      const caller = await admitWrite(deps, request, reply);
      if (caller === undefined) return reply;
      const acr = await acrForRemoval(deps, caller);
      if (!(await signInIsFresh(deps, caller, reply, acr))) return reply;
      const outcome = await removeCredential(deps, caller, request.params.id);
      if (outcome.kind === 'not_found') return respond(reply, 404, notFound(NO_AUTHENTICATOR));
      if (outcome.kind === 'refused') return respond(reply, 409, removalRefused(outcome.code));
      return respond(reply, 204);
    },
  );

  app.post<{ Params: { tenant: string } }>(DELEGATIONS_POST.url, async (request, reply) => {
    const caller = await admitWrite(deps, request, reply);
    if (caller === undefined) return reply;
    const body = DELEGATIONS_POST.body.safeParse(request.body);
    if (!body.success) return respond(reply, 400, invalidBody(body.error.issues));
    if (!(await signInIsFresh(deps, caller, reply))) return reply;
    const outcome = await createDelegation(deps, caller, body.data);
    if (outcome.kind === 'invalid') {
      return respond(reply, 400, invalidRequest(`${outcome.field}: ${outcome.description}`));
    }
    if (outcome.kind === 'limit_reached') return respond(reply, 409, delegationLimit());
    return respond(reply, 201, delegationDto(outcome.delegation));
  });

  app.delete<{ Params: { tenant: string; id: string } }>(
    DELEGATION_DELETE.url,
    async (request, reply) => {
      if (!isUuid(request.params.id)) return respond(reply, 404, notFound(NO_DELEGATION));
      const caller = await admitWrite(deps, request, reply);
      if (caller === undefined) return reply;
      if (!(await sessionIsLive(deps, caller, reply))) return reply;
      const outcome = await revokeDelegation(deps, caller, request.params.id);
      if (outcome.kind === 'not_found') return respond(reply, 404, notFound(NO_DELEGATION));
      return respond(reply, 204);
    },
  );
}

// Every URL the "me" routes answer, the preflight's included.
export const isMeRoute = (url: string | undefined): boolean => url?.startsWith(`${BASE}/`) === true;

export function registerMeRoutes(app: FastifyInstance, deps: MeDeps): void {
  registerPreflight(app, deps);
  registerWrites(app, deps);
  app.get<{ Params: { tenant: string } }>(PROFILE_GET.url, async (request, reply) => {
    const caller = await admit(deps, request, reply);
    if (caller === undefined) return reply;
    if (!PROFILE_GET.query.safeParse(request.query).success) {
      return respond(reply, 400, invalidRequest('The query is not valid'));
    }
    const outcome = await readProfile(deps, caller);
    if (outcome.kind === 'not_found') {
      return respond(reply, 404, notFound('There is no profile for this account'));
    }
    return respond(reply, 200, profileDto(outcome.profile));
  });
  listRoute(app, deps, CREDENTIALS_GET, listCredentials, (o) =>
    credentialsDto(o.items, o.next, o.recoveryCodesLeft, o.recoveryCodesLow),
  );
  listRoute(app, deps, SESSIONS_GET, listSessions, (o) => sessionsDto(o.items, o.next));
  listRoute(app, deps, CONSENTS_GET, listConsents, (o) => consentsDto(o.items, o.next));
  app.get<{ Params: { tenant: string } }>(DELEGATIONS_GET.url, async (request, reply) => {
    const caller = await admit(deps, request, reply);
    if (caller === undefined) return reply;
    if (!DELEGATIONS_GET.query.safeParse(request.query).success) {
      return respond(reply, 400, invalidRequest('The query is not valid'));
    }
    const outcome = await listDelegations(deps, caller);
    return respond(reply, 200, delegationsDto(outcome.items));
  });
}
