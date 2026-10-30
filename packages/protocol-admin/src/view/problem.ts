import { BIDI_FREE_PATTERN, BIDI_REFUSED, BIDI_REFUSED_MESSAGE } from '@odudu/contracts';
import { type FieldError, type ProblemDetails } from '@odudu/contracts/admin';
import { BidiControlError } from '@odudu/kernel';
import {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { type z } from 'zod';
import { fieldPath } from '#/service/field-path';

export type Problem = Omit<ProblemDetails, 'instance' | 'errors'> & {
  errors?: readonly FieldError[];
};

export function problem(status: number, type: string, title: string, detail?: string): Problem {
  return detail === undefined ? { type, title, status } : { type, title, status, detail };
}

/**
 * The one shape of a `400` that names what was wrong with the request:
 * `errors` places each message under its field, and `detail` stays the prose
 * a person reads — given, or else each field and its message in turn.
 */
export function fieldProblem(
  errors: readonly FieldError[],
  detail?: string,
  type = 'about:blank',
): Problem {
  const prose = detail ?? errors.map((error) => `${error.path}: ${error.message}`).join('; ');
  return { ...problem(400, type, 'Bad Request', prose), errors: errors.map(withCode) };
}

// The one refusal that carries a code today is a bidirectional control in a
// typed field; every door words it with `BIDI_REFUSED_MESSAGE`, so the code
// follows the sentence wherever the refusal was found.
function withCode(error: FieldError): FieldError {
  return error.code === undefined && error.message === BIDI_REFUSED_MESSAGE
    ? { ...error, code: BIDI_REFUSED }
    : error;
}

/** A query a Zod schema refused, its first message as the detail. */
export function queryProblem(error: z.ZodError): Problem {
  const detail = error.issues[0]?.message ?? 'invalid query';
  // A parameter the route does not take is named by itself, as the body's
  // unknown fields are.
  const errors = error.issues.flatMap((issue) =>
    issue.code === 'unrecognized_keys'
      ? issue.keys.map((key) => ({ path: key, message: 'is not a parameter of this route' }))
      : issue.path.length > 0
        ? [{ path: fieldPath(issue.path), message: issue.message }]
        : [],
  );
  return errors.length === 0
    ? problem(400, 'about:blank', 'Bad Request', detail)
    : fieldProblem(errors, detail);
}

export function cursorProblem(): Problem {
  return fieldProblem(
    [{ path: 'cursor', message: 'is invalid or expired' }],
    'cursor is invalid or expired',
  );
}

/**
 * The two refusals a mandatory `If-Match` produces, worded once for every
 * route that replaces an authorization-bearing list whole. `resource`
 * names what the caller has to read first, since the header is the only
 * thing missing from an otherwise valid request.
 */
export function ifMatchRequired(resource: string, sent: string | string[] | undefined): Problem {
  return problem(
    428,
    'about:blank',
    'Precondition Required',
    sent === undefined
      ? `If-Match is required to replace ${resource}`
      : `If-Match must name a version you read; * is not accepted when replacing ${resource}`,
  );
}

/**
 * A capability ceiling's `403`, naming apart what the write would grant and
 * what it would take from whoever holds it, each beyond the caller's own.
 */
export function ceilingProblem(
  granted: readonly string[],
  removed: readonly string[] = [],
): Problem {
  const parts = [
    ...(granted.length > 0 ? [`the caller does not hold: ${granted.join(', ')}`] : []),
    ...(removed.length > 0
      ? [`this removes capabilities the caller does not hold: ${removed.join(', ')}`]
      : []),
  ];
  return problem(403, 'about:blank', 'Forbidden', parts.join('; '));
}

/** A write that would leave the tenant with no enabled administrator; `reason` names who. */
export function lastAdministratorProblem(reason: string): Problem {
  return problem(409, 'about:blank#last-administrator', 'Conflict', reason);
}

/** A delete of a subject that a client names as its service account. */
export function serviceAccountProblem(clientId: string): Problem {
  return problem(
    409,
    'about:blank#service-account',
    'Conflict',
    `This subject is the service account of client ${clientId}. Delete the client instead.`,
  );
}

export function ifMatchStale(detail = 'If-Match no longer matches'): Problem {
  return problem(412, 'about:blank', 'Precondition Failed', detail);
}

export function sendProblem(
  reply: FastifyReply,
  request: FastifyRequest,
  body: Problem,
): FastifyReply {
  return reply
    .code(body.status)
    .header('content-type', 'application/problem+json')
    .send({ ...body, instance: request.id });
}

// ajv's message for a closed schema says only that something extra was
// sent; the name of what was sent is what a caller needs to fix it.
export function refusalDetail(error: Pick<FastifyError, 'message' | 'validation'>): string {
  const first = error.validation?.[0];
  const extra: unknown =
    first?.keyword === 'additionalProperties' ? first.params.additionalProperty : undefined;
  return typeof extra === 'string' ? `${error.message}: ${extra}` : error.message;
}

function pointerSegments(pointer: string): (string | number)[] {
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .map((segment) => (/^\d+$/u.test(segment) ? Number(segment) : segment));
}

// ajv reports where it failed as a JSON pointer, and a missing or extra
// property one level above the property itself.
export function validationErrors(
  error: Pick<FastifyError, 'message' | 'validation'>,
): readonly FieldError[] {
  const entries = error.validation ?? [];
  // A nullable field is an `anyOf`, so a refused string arrives with the
  // branch that wanted `null` and the union's own failure beside it: the
  // pattern is the one that says what was wrong.
  const refusedHere = new Set(entries.filter(isBidiRefusal).map((entry) => entry.instancePath));
  return entries.flatMap((entry) => {
    if (refusedHere.has(entry.instancePath) && !isBidiRefusal(entry)) return [];
    const segments = pointerSegments(entry.instancePath);
    const named: unknown =
      entry.keyword === 'additionalProperties'
        ? entry.params.additionalProperty
        : entry.keyword === 'required'
          ? entry.params.missingProperty
          : undefined;
    if (typeof named === 'string') segments.push(named);
    const path = fieldPath(segments);
    if (path === '') return [];
    return isBidiRefusal(entry)
      ? [{ path, message: BIDI_REFUSED_MESSAGE, code: BIDI_REFUSED }]
      : [{ path, message: entry.message ?? error.message }];
  });
}

function isBidiRefusal(entry: { keyword: string; params: Record<string, unknown> }): boolean {
  return entry.keyword === 'pattern' && entry.params.pattern === BIDI_FREE_PATTERN.source;
}

/** Scoped to this plugin's encapsulation context, never the root instance, so RFC 6749 error bodies on the OIDC routes are untouched. */
export function installProblemDetailsHandler(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof BidiControlError) {
      sendProblem(
        reply,
        request,
        fieldProblem([{ path: error.field, message: BIDI_REFUSED_MESSAGE }]),
      );
      return;
    }
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status >= 500) {
      sendProblem(reply, request, problem(status, 'about:blank', 'Internal Server Error'));
      return;
    }
    const errors = status === 400 ? validationErrors(error) : [];
    // The schema's own text for this refusal is a regular expression: the
    // detail says which field and why, in the words every door uses.
    const refused = errors.filter((entry) => entry.code === BIDI_REFUSED);
    const detail =
      refused.length > 0
        ? refused.map((entry) => `${entry.path}: ${entry.message}`).join('; ')
        : refusalDetail(error);
    const body = problem(status, 'about:blank', error.name, detail);
    sendProblem(reply, request, errors.length === 0 ? body : { ...body, errors });
  });
}
