import { type Database, type TenantScopedDatabase } from '@odudu/db';
import { isSystemTenantId, SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { type Clock } from '@odudu/kernel';
import { issuerBaseFor, tenantIssuerFor } from '@odudu/protocol-oidc';
import { Transform } from 'node:stream';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  agentBodyAdmitted,
  doorToolName,
  agentBodyNamesGuardedField,
  agentGuardsBuiltinScope,
  agentGuardsWholeClient,
  agentWriteNeedsEndpoint,
  agentWritesClient,
  scopeAdmits,
} from '#/service/agent-scope';
import { ADMIN_ROUTES, type AdminRoute } from '#/service/capability';
import { declaredEssence, declaredTypeDetail } from '#/service/declared-type';
import { paramsSchemaFor } from '#/service/path-params';
import {
  recordAgentRefused,
  recordAgentToolCall,
  recordCapabilityRefused,
  recordForeignIssuer,
} from '#/usecase/access-audit';
import {
  authenticateAdmin,
  type AdminPrincipal,
  type AuthenticateAdminDeps,
} from '#/usecase/authenticate-admin';
import { authorizeAdmin, type AuthorizeAdminDeps } from '#/usecase/authorize-admin';
import { scopeIsBuiltin } from '#/usecase/scopes';
import { idempotencyKeyOf, idempotentMethod } from '#/service/idempotency';
import {
  idempotencyBusy,
  idempotencyKeyInvalid,
  idempotencyUnavailable,
  idempotencyUnsupported,
  problem,
  queryProblem,
  sendProblem,
} from '#/view/problem';
import { sendIdempotent } from '#/view/routes/idempotent-route';
import { createKeyedGate, keyedLimitFor, type KeyedGate } from '#/view/routes/keyed-gate';
import { adminTx } from '#/view/routes/admin-tx';

// Optional: `/admin/tenants` itself carries no `:tenant` segment (see
// `targetTenantNameFor` below), and most routes carry no `:id` segment
// either — Fastify never populates a param ADMIN_ROUTES' own pattern does
// not declare, so the type says both are absent rather than leaving a
// reader to notice at runtime.
export interface AdminRouteParams {
  readonly tenant?: string;
  readonly id?: string;
  readonly credentialId?: string;
  readonly sid?: string;
  readonly clientId?: string;
  readonly childId?: string;
  readonly versionId?: string;
  readonly assetId?: string;
}

export type AdminRequest = FastifyRequest<{ Params: AdminRouteParams }>;

export type AdminRouteHandler = (
  request: AdminRequest,
  reply: FastifyReply,
  principal: AdminPrincipal,
  targetTenantId: string,
) => FastifyReply | Promise<FastifyReply>;

export interface AdminRouterDeps {
  readonly auth: AuthenticateAdminDeps;
  readonly authz: AuthorizeAdminDeps;
  readonly clock: Clock;
  readonly database: Database;
  // The serving pool's size, which bounds how many keyed calls run at once.
  // Read on the first keyed call, so an app that never keys a request never asks.
  readonly poolMax: () => number;
}

/** Keyed by `"<method> <pattern>"`, exactly matching an `ADMIN_ROUTES` entry. */
export type AdminRouteHandlers = Readonly<Record<string, AdminRouteHandler>>;

function routeKey(method: string, pattern: string): string {
  return `${method} ${pattern}`;
}

function sendUnauthorized(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendProblem(reply, request, problem(401, 'about:blank', 'Unauthorized'));
}

function sendForbidden(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendProblem(reply, request, problem(403, 'about:blank', 'Forbidden'));
}

function sendInsufficientScope(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendProblem(
    reply,
    request,
    problem(403, 'about:blank', 'Forbidden', 'insufficient_scope'),
  );
}

// A route's target tenant comes from its own path when it has one. The
// handful with no `:tenant` segment administer the tenant collection
// itself, not any one tenant's data — so their target is the system
// tenant, explicitly, rather than an absent path param read as one by
// accident. `route.pattern` (the table entry), not `request.params`,
// decides which case this is, so the two can never disagree.
function targetTenantNameFor(route: AdminRoute, params: AdminRouteParams): string {
  if (!route.pattern.includes(':tenant')) return SYSTEM_TENANT_NAME;
  const tenant = params.tenant;
  if (tenant === undefined) {
    throw new Error(`protocol-admin: route ${route.pattern} declares :tenant but received none`);
  }
  return tenant;
}

// A refusal is sent whether or not its row could be written.
export async function recordRefusal(
  database: Database,
  request: FastifyRequest,
  tenantId: string,
  write: (tx: TenantScopedDatabase) => Promise<void>,
): Promise<void> {
  try {
    await adminTx(database, request, tenantId, write);
  } catch (error) {
    request.log.error({ err: error, tenantId }, 'could not record a refused admin request');
  }
}

interface Granted {
  readonly principal: AdminPrincipal;
  readonly tenantId: string;
}

async function refuseScope(
  deps: AdminRouterDeps,
  request: AdminRequest,
  reply: FastifyReply,
  tenantId: string,
  principal: AdminPrincipal,
): Promise<void> {
  await recordRefusal(deps.database, request, tenantId, (tx) =>
    recordAgentRefused(tx, principal, 'insufficient_scope'),
  );
  sendInsufficientScope(request, reply);
}

// Authenticates and authorizes the request against its route; null when it
// has already answered the refusal.
async function authorizeRoute(
  route: AdminRoute,
  deps: AdminRouterDeps,
  request: AdminRequest,
  reply: FastifyReply,
): Promise<Granted | null> {
  const targetTenantName = targetTenantNameFor(route, request.params);
  const targetTenant = await deps.auth.findTenant(targetTenantName);
  if (targetTenant === null) {
    request.log.warn({ reason: 'unknown_tenant' }, 'admin request unauthenticated');
    sendUnauthorized(request, reply);
    return null;
  }

  const outcome = await authenticateAdmin(deps.auth, {
    authorizationHeader: request.headers.authorization,
    targetTenantName,
    targetTenant,
    targetTenantIssuer: tenantIssuerFor(request, targetTenantName),
    systemTenantIssuer: tenantIssuerFor(request, SYSTEM_TENANT_NAME),
    issuerBase: issuerBaseFor(request),
    now: deps.clock.now(),
  });
  if (outcome.kind === 'forbidden') {
    await recordRefusal(deps.database, request, targetTenant.id, (tx) =>
      recordAgentRefused(tx, outcome.principal, outcome.reason),
    );
    sendForbidden(request, reply);
    return null;
  }
  if (outcome.kind === 'unauthenticated') {
    const foreign = outcome.foreignIssuer;
    if (outcome.foreignIssuerError !== undefined) {
      request.log.error(
        { err: outcome.foreignIssuerError, reason: outcome.reason },
        'could not resolve the issuer of a refused admin request',
      );
    } else if (foreign === undefined) {
      request.log.warn({ reason: outcome.reason }, 'admin request unauthenticated');
    } else {
      await recordRefusal(deps.database, request, targetTenant.id, (tx) =>
        recordForeignIssuer(tx, foreign),
      );
    }
    sendUnauthorized(request, reply);
    return null;
  }

  const { principal } = outcome;
  if (
    principal.agent !== undefined &&
    (principal.issuerTenantId !== targetTenant.id ||
      !scopeAdmits(principal.scopes, route, isSystemTenantId(principal.issuerTenantId)) ||
      (agentWriteNeedsEndpoint(route) &&
        (principal.agent.viaEndpoint !== true || principal.agent.ownerIsServiceAccount === true)))
  ) {
    await refuseScope(deps, request, reply, targetTenant.id, principal);
    return null;
  }

  const decision = await authorizeAdmin(
    deps.authz,
    outcome.principal,
    { tenantId: targetTenant.id },
    route.capability,
    route.alsoAdmits,
  );
  if (decision.kind === 'forbidden') {
    await recordRefusal(deps.database, request, targetTenant.id, (tx) =>
      recordCapabilityRefused(tx, outcome.principal, decision.missing, decision.alsoAdmits),
    );
    sendForbidden(request, reply);
    return null;
  }

  return { principal: outcome.principal, tenantId: targetTenant.id };
}

// What a body route's `onRequest` decided, for its handler to reuse instead
// of deciding twice.
const GRANTED = new WeakMap<FastifyRequest, Granted>();

async function agentMayWrite(
  route: AdminRoute,
  deps: AdminRouterDeps,
  request: AdminRequest,
  granted: Granted,
): Promise<boolean> {
  if (!agentBodyAdmitted(route, request.body)) return false;
  if (agentGuardsBuiltinScope(route)) {
    const scopeId = request.params.id;
    if (scopeId === undefined) return true;
    return !(await adminTx(deps.database, request, granted.tenantId, (tx) =>
      scopeIsBuiltin(tx, scopeId),
    ));
  }
  if (!agentWritesClient(route)) return true;
  if (!agentGuardsWholeClient(route) && !agentBodyNamesGuardedField(request.body)) return true;
  const id = request.params.id;
  const target = id === undefined ? null : await deps.auth.loadClientState(granted.tenantId, id);
  return target === null || !(target.builtinAdmin || target.builtinMcp);
}

async function handleRoute(
  route: AdminRoute,
  handler: AdminRouteHandler,
  deps: AdminRouterDeps,
  request: AdminRequest,
  reply: FastifyReply,
  gate: KeyedGate,
): Promise<FastifyReply> {
  const granted = GRANTED.get(request) ?? (await authorizeRoute(route, deps, request, reply));
  if (granted === null) return reply;
  // Only now is the body parsed, so the fields an agent may write are
  // decided here, on the object the handler is about to read.
  if (granted.principal.agent !== undefined && route.method !== 'GET') {
    if (!(await agentMayWrite(route, deps, request, granted))) {
      await refuseScope(deps, request, reply, granted.tenantId, granted.principal);
      return reply;
    }
  }
  if (!(await recordDirectAgentCall(route, deps, request, granted))) {
    return sendProblem(
      reply,
      request,
      problem(
        503,
        'about:blank',
        'Service Unavailable',
        'the call could not be recorded, so it was not run',
      ),
    );
  }
  return answerRoute(route, handler, deps, request, reply, granted, gate);
}

// An agent that holds a token issued to it, with no `act`, reached the admin
// API without the MCP endpoint, which would have recorded the call. Its row is
// written before the handler runs, and the call is not run without one: an
// access nobody can see was made is what the trail exists to prevent.
async function recordDirectAgentCall(
  route: AdminRoute,
  deps: AdminRouterDeps,
  request: AdminRequest,
  granted: Granted,
): Promise<boolean> {
  const { principal } = granted;
  if (principal.agent === undefined || principal.agent.viaEndpoint === true) return true;
  const agent = principal.agent;
  const key = routeKey(route.method, route.pattern);
  try {
    await adminTx(deps.database, request, granted.tenantId, (tx) =>
      recordAgentToolCall(
        tx,
        { ...principal, agent },
        { tool: doorToolName(key), route: key, outcome: 'allowed' },
      ),
    );
    return true;
  } catch (error) {
    request.log.error({ err: error, tenantId: granted.tenantId }, 'could not record an agent call');
    return false;
  }
}

// A POST that names an `Idempotency-Key` runs once and is answered from its
// record afterwards; every other request goes straight to its handler.
function answerRoute(
  route: AdminRoute,
  handler: AdminRouteHandler,
  deps: AdminRouterDeps,
  request: AdminRequest,
  reply: FastifyReply,
  granted: Granted,
  gate: KeyedGate,
): FastifyReply | Promise<FastifyReply> {
  const run = () => handler(request, reply, granted.principal, granted.tenantId);
  if (!idempotentMethod(route.method)) return run();
  const header = idempotencyKeyOf(request.headers['idempotency-key']);
  if (header.kind === 'absent') return run();
  if (header.kind === 'invalid') return sendProblem(reply, request, idempotencyKeyInvalid());
  if (route.noIdempotency !== undefined) {
    return sendProblem(reply, request, idempotencyUnsupported(route.noIdempotency));
  }
  return enterGate(gate, request, reply, () =>
    sendIdempotent({
      database: deps.database,
      request,
      reply,
      route,
      tenantId: granted.tenantId,
      principal: granted.principal,
      key: header.key,
      now: deps.clock.now(),
      run,
    }),
  );
}

// A keyed call waits here for a slot, holding no connection, and is refused
// when there is none to be had.
async function enterGate(
  gate: KeyedGate,
  request: AdminRequest,
  reply: FastifyReply,
  run: () => Promise<FastifyReply>,
): Promise<FastifyReply> {
  const gone = new AbortController();
  // The request's own `close` fires once its body has been read, with the
  // caller still waiting; the response's closes with the connection.
  const onClose = () => {
    if (!reply.raw.writableFinished) gone.abort();
  };
  reply.raw.once('close', onClose);
  try {
    const entry = await gate.acquire(gone.signal);
    if (entry.kind === 'refused') {
      if (entry.reason === 'disabled') {
        sendProblem(reply, request, idempotencyUnavailable());
      } else {
        reply.header('retry-after', '1');
        sendProblem(reply, request, idempotencyBusy());
      }
      return await reply;
    }
    reply.raw.off('close', onClose);
    try {
      return await run();
    } finally {
      entry.release();
    }
  } finally {
    reply.raw.off('close', onClose);
  }
}

// Before the body of a JSON route is read or checked: who is asking, and
// whether they may. Only the route's capability and the path's tenant are
// needed, and both are known from the request line. A refusal answers
// without the body ever being buffered or validated.
async function beforeJsonBody(
  route: AdminRoute,
  deps: AdminRouterDeps,
  request: AdminRequest,
  reply: FastifyReply,
): Promise<FastifyReply | undefined> {
  const granted = await authorizeRoute(route, deps, request, reply);
  if (granted === null) return reply;
  GRANTED.set(request, granted);
  return undefined;
}

// Before any of the body is read: who is asking, which kind and how large.
// A refusal answers without the body ever being consumed.
async function beforeRawBody(
  route: AdminRoute,
  rawBody: NonNullable<AdminRoute['rawBody']>,
  deps: AdminRouterDeps,
  request: AdminRequest,
  reply: FastifyReply,
): Promise<FastifyReply | undefined> {
  const granted = await authorizeRoute(route, deps, request, reply);
  if (granted === null) return reply;
  GRANTED.set(request, granted);

  // The refusal Fastify's own validation would give, which only runs after
  // the body has been read.
  const query = route.querystringSchema?.safeParse(request.query);
  if (query?.success === false) return sendProblem(reply, request, queryProblem(query.error));
  const limit = rawBody.limitFor(request.query);
  if (limit === null) {
    return sendProblem(reply, request, problem(400, 'about:blank', 'Bad Request', 'invalid query'));
  }
  // Fastify refuses an undeclared type itself, generically, once the parsers
  // are replaced; the route's own refusal is given here instead.
  const unsupported = rawBody.unsupportedType;
  if (unsupported !== undefined) {
    const essence = declaredEssence(request.headers['content-type']);
    if (essence === undefined || !rawBody.contentTypes.includes(essence)) {
      return sendProblem(
        reply,
        request,
        problem(
          415,
          unsupported.type,
          unsupported.title,
          declaredTypeDetail(essence, rawBody.contentTypes),
        ),
      );
    }
  }

  // A chunked body declares no length (NaN, never over); `limited` in
  // preParsing stops it at the limit.
  const declared = Number(request.headers['content-length']);
  if (declared > limit) throw bodyTooLarge();
  return undefined;
}

// Shaped like Fastify's own refusal, so the problem handler answers it as a 413.
function bodyTooLarge(): Error {
  return Object.assign(new Error('Request body is too large'), {
    name: 'Content Too Large',
    code: 'FST_ERR_CTP_BODY_TOO_LARGE',
    statusCode: 413,
  });
}

// A body counted as it arrives, so one with no length declared, or a wrong
// one, is stopped at the limit rather than at the end.
function limited(payload: NodeJS.ReadableStream, limit: number): NodeJS.ReadableStream {
  let seen = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.length;
      if (seen > limit) done(bodyTooLarge());
      else done(null, chunk);
    },
  });
  payload.on('error', (error: Error) => counter.destroy(error));
  return payload.pipe(counter);
}

/**
 * The only place `ADMIN_ROUTES` becomes live Fastify routes. Every table
 * entry must have a handler and every handler must have a table entry —
 * either mismatch throws here, at startup, rather than leaving the table
 * and the router free to disagree at request time.
 */
export function registerAdminRoutes(
  app: FastifyInstance,
  handlers: AdminRouteHandlers,
  deps: AdminRouterDeps,
): void {
  const unclaimed = new Set(Object.keys(handlers));
  let sized: KeyedGate | undefined;
  const gate: KeyedGate = {
    acquire: (signal) => {
      sized ??= createKeyedGate(keyedLimitFor(deps.poolMax()));
      return sized.acquire(signal);
    },
  };

  for (const route of ADMIN_ROUTES) {
    const key = routeKey(route.method, route.pattern);
    const handler = handlers[key];
    if (handler === undefined) {
      throw new Error(`protocol-admin: ADMIN_ROUTES entry ${key} has no registered handler`);
    }
    unclaimed.delete(key);

    const paramsSchema = paramsSchemaFor(route.pattern);
    const rawBody = route.rawBody;
    const options = {
      method: route.method,
      url: route.pattern,
      ...(route.bodyLimit === undefined ? {} : { bodyLimit: route.bodyLimit }),
      schema: {
        ...(paramsSchema === undefined ? {} : { params: paramsSchema }),
        ...(route.querystringSchema !== undefined ? { querystring: route.querystringSchema } : {}),
        ...(route.bodySchema !== undefined ? { body: route.bodySchema } : {}),
      },
      handler: (request: AdminRequest, reply: FastifyReply) =>
        handleRoute(route, handler, deps, request, reply, gate),
    };
    // Every admin response is specific to its caller, and several carry a
    // secret shown once; set before validation, so a refusal carries it too.
    const noStore = (_request: FastifyRequest, reply: FastifyReply, done: () => void) => {
      reply.header('cache-control', 'no-store');
      done();
    };

    if (rawBody === undefined) {
      const hasBody = route.bodySchema !== undefined || route.bodyLimit !== undefined;
      app.route<{ Params: AdminRouteParams }>({
        ...options,
        onRequest: hasBody
          ? [noStore, async (request, reply) => beforeJsonBody(route, deps, request, reply)]
          : noStore,
      });
      continue;
    }
    // The parsers for a raw body live in a scope of their own, so no other
    // route's content types change; JSON is not one of them here.
    app.register((scope, _opts, done) => {
      scope.removeAllContentTypeParsers();
      scope.addContentTypeParser(
        [...rawBody.contentTypes],
        { parseAs: 'buffer' },
        (_request, body, parsed) => {
          parsed(null, body);
        },
      );
      scope.route<{ Params: AdminRouteParams }>({
        ...options,
        onRequest: [
          noStore,
          async (request, reply) => beforeRawBody(route, rawBody, deps, request, reply),
        ],
        preParsing: async (request, _reply, payload) => {
          const limit = rawBody.limitFor(request.query);
          return limit === null ? payload : limited(payload, limit);
        },
      });
      done();
    });
  }

  if (unclaimed.size > 0) {
    throw new Error(
      `protocol-admin: handler(s) registered for route(s) missing from ADMIN_ROUTES: ${[...unclaimed].join(', ')}`,
    );
  }
}
