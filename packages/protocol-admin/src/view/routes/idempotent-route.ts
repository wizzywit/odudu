import { type Database } from '@odudu/db';
import { type FastifyReply, type FastifyRequest } from 'fastify';
import { type AdminRoute } from '#/service/capability';
import { fingerprintOf, principalFingerprint, replayedHeaders } from '#/service/idempotency';
import { type AdminPrincipal } from '#/usecase/authenticate-admin';
import {
  IdempotencyRollback,
  withIdempotency,
  type IdempotencyResult,
  type IdempotentResponse,
  type RunOutcome,
} from '#/usecase/idempotent';
import {
  idempotencyCapacity,
  idempotencyInFlight,
  idempotencyKeyReused,
  idempotencyResponseTooLarge,
  sendProblem,
  type Problem,
} from '#/view/problem';
import { adminTx, withRequestTransaction } from '#/view/routes/admin-tx';

const JSON_TYPE = 'application/json; charset=utf-8';

export interface IdempotentCall {
  readonly database: Database;
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
  readonly route: AdminRoute;
  readonly tenantId: string;
  readonly principal: AdminPrincipal;
  readonly key: string;
  readonly now: Date;
  readonly run: () => FastifyReply | Promise<FastifyReply>;
}

interface Captured {
  readonly payload: unknown;
}

// What a handler gives `reply.send`, held back so the response can be kept
// in the transaction that made it before anything is written to the wire. A
// reply is thenable and settles when the response has gone out, so awaiting
// one a handler returned would wait for the very send held here; its `then`
// settles at once while the send is held.
function holdSend(reply: FastifyReply): { taken: () => Captured | undefined; release: () => void } {
  let captured: Captured | undefined;
  reply.send = (payload?: unknown): FastifyReply => {
    captured = { payload };
    return reply;
  };
  reply.then = (fulfilled) => {
    fulfilled();
  };
  return {
    taken: () => captured,
    release: () => {
      Reflect.deleteProperty(reply, 'send');
      Reflect.deleteProperty(reply, 'then');
    },
  };
}

type Serialised = { readonly kind: 'text'; readonly body: string } | { readonly kind: 'opaque' };

function serialise(payload: unknown): Serialised {
  if (payload === undefined || payload === null) return { kind: 'text', body: '' };
  if (typeof payload === 'string') return { kind: 'text', body: payload };
  if (Buffer.isBuffer(payload) || typeof payload !== 'object') return { kind: 'opaque' };
  if ('pipe' in payload) return { kind: 'opaque' };
  return { kind: 'text', body: JSON.stringify(payload) };
}

function problemFor(result: IdempotencyRollback['result']): Problem {
  return result.kind === 'capacity' ? idempotencyCapacity() : idempotencyResponseTooLarge();
}

function answerRefused(
  reply: FastifyReply,
  request: FastifyRequest,
  result: Exclude<IdempotencyResult, { kind: 'stored' | 'fresh' }>,
): FastifyReply {
  switch (result.kind) {
    case 'in_flight':
      return sendProblem(reply, request, idempotencyInFlight());
    case 'reused':
      return sendProblem(reply, request, idempotencyKeyReused());
    case 'capacity':
      return sendProblem(reply, request, idempotencyCapacity());
  }
}

function replay(reply: FastifyReply, stored: IdempotentResponse): FastifyReply {
  reply.code(stored.status).headers(stored.headers).header('idempotent-replayed', 'true');
  return reply.send(stored.body === '' ? undefined : stored.body);
}

/**
 * Runs the route's handler once for the key and answers every repeat from
 * the response it gave. The handler's writes and the record of its response
 * share one transaction: a record proves the call happened, and a call that
 * failed or was refused leaves none.
 */
// What the call asked to happen once it was committed. One that throws is
// logged and skipped: the call is done, and the caller is told so.
export function runAfterCommit(effects: readonly (() => void)[], request: FastifyRequest): void {
  for (const effect of effects) {
    try {
      effect();
    } catch (error) {
      request.log.error({ err: error }, 'an effect after a committed keyed call failed');
    }
  }
}

export async function sendIdempotent(call: IdempotentCall): Promise<FastifyReply> {
  const { request, reply, route, tenantId, principal } = call;
  const held = holdSend(reply);
  let heldPayload: unknown;
  let after: readonly (() => void)[] = [];
  let result: IdempotencyResult;
  try {
    result = await adminTx(call.database, request, tenantId, (tx) =>
      withIdempotency(
        tx,
        {
          tenantId,
          key: call.key,
          route: `${route.method} ${route.pattern}`,
          fingerprint: principalFingerprint(
            {
              subjectId: principal.subjectId,
              issuerTenantId: principal.issuerTenantId,
              agentClientId: principal.agent?.clientId,
            },
            fingerprintOf(request.method, request.url, request.body),
          ),
          now: call.now,
        },
        async (): Promise<RunOutcome> => {
          const ran = await withRequestTransaction(request, tenantId, tx, async () => {
            await call.run();
          });
          after = ran.after;
          heldPayload = held.taken()?.payload;
          const serialised = serialise(heldPayload);
          const headers = replayedHeaders(reply.getHeaders());
          const typed =
            serialised.kind === 'text' &&
            serialised.body !== '' &&
            headers['content-type'] === undefined
              ? { ...headers, 'content-type': JSON_TYPE }
              : headers;
          return {
            response: {
              status: reply.statusCode,
              body: serialised.kind === 'text' ? serialised.body : '',
              headers: typed,
            },
            withinTransaction: ran.joined && serialised.kind === 'text',
          };
        },
      ),
    );
  } catch (error) {
    held.release();
    if (error instanceof IdempotencyRollback) {
      return sendProblem(reply, request, problemFor(error.result));
    }
    throw error;
  }
  held.release();

  if (result.kind === 'stored') return replay(reply, result.response);
  if (result.kind !== 'fresh') return answerRefused(reply, request, result);
  runAfterCommit(after, request);
  if (!result.stored) return reply.send(heldPayload);
  const { body, headers } = result.response;
  if (headers['content-type'] !== undefined) reply.header('content-type', headers['content-type']);
  return reply.send(body === '' ? undefined : body);
}
