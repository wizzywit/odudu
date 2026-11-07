import { isEtag } from '#/service/etag-shape';
import { ToolProblem, type AdminMethod, type AdminRequestSpec } from '#/service/tool';

// What a call may read back: the admin API's own page size bounds rows, not
// bytes, and a model reads whatever is returned.
export const ADMIN_BODY_CAP_BYTES = 1_048_576;

// What a tool may send: a description or a name is short, and the admin API
// has its own bound, so this is only a stop on what leaves this layer.
export const REQUEST_BODY_CAP_BYTES = 65_536;

export const RETURNED_HEADERS = ['content-type', 'etag', 'retry-after'] as const;

// A request the caller refuses to build is a refusal of the arguments, said as
// a 400 so that nothing was sent and a write's place in its budget is given back.
export function preflight<T>(build: () => T): T {
  try {
    return build();
  } catch (error) {
    if (error instanceof ToolProblem) throw error;
    const reason = error instanceof Error ? error.message : 'the request could not be built';
    throw new ToolProblem('mcp:invalid_arguments', reason, 400);
  }
}

// The same character set the admin API accepts for `Idempotency-Key`, which
// is a subset of visible ASCII with no space, quote or separator.
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,255}$/u;

// The bytes of a request body, or nothing for a call without one. A body is a
// JSON record on a PATCH, POST or PUT and on nothing else; a tool may name a
// cap of its own for it, never above what a call may read back.
export function payloadOf(req: AdminRequestSpec): string | undefined {
  const cap = req.bodyCap ?? REQUEST_BODY_CAP_BYTES;
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > ADMIN_BODY_CAP_BYTES) {
    throw new Error('a body cap is a whole number of bytes, at most the read cap');
  }
  if (req.body === undefined) return undefined;
  if (!BODY_METHODS.includes(req.method)) {
    throw new Error('only a PATCH, POST or PUT carries a body');
  }
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('a body is a JSON record');
  }
  const payload = JSON.stringify(req.body);
  if (Buffer.byteLength(payload) > cap) {
    throw new Error('the request body is too large');
  }
  return payload;
}

const BODY_METHODS: readonly AdminMethod[] = ['PATCH', 'POST', 'PUT'];
const PRECONDITION_METHODS: readonly AdminMethod[] = ['PATCH', 'PUT', 'DELETE'];

// The precondition of a write: one strong etag, on a call that replaces or
// removes what is there.
export function preconditionOf(req: AdminRequestSpec): string | undefined {
  if (req.ifMatch === undefined) return undefined;
  if (!PRECONDITION_METHODS.includes(req.method)) {
    throw new Error('only a PATCH, PUT or DELETE carries a precondition');
  }
  if (!isEtag(req.ifMatch)) throw new Error('a precondition is one strong entity tag');
  return req.ifMatch;
}

// The key a POST is sent with, so that a retry of it makes one thing and not
// two. A POST names one and no other method does.
export function idempotencyKeyOf(req: AdminRequestSpec): string | undefined {
  if (req.method !== 'POST') {
    if (req.idempotencyKey !== undefined) throw new Error('only a POST carries an idempotency key');
    return undefined;
  }
  if (req.idempotencyKey === undefined || !IDEMPOTENCY_KEY_PATTERN.test(req.idempotencyKey)) {
    throw new Error('a POST needs an idempotency key of 1 to 255 letters, digits and _.:-');
  }
  return req.idempotencyKey;
}

export function returnedHeaders(
  headers: Readonly<Record<string, string | string[] | number | undefined>>,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const name of RETURNED_HEADERS) {
    const value = headers[name];
    if (typeof value === 'string') kept[name] = value;
  }
  return kept;
}

const JSON_MEDIA_TYPE = /^[^/\s]+\/(?:[^/\s]+\+)?json$/u;

// The media type's type and subtype, without parameters, in lower case: media
// types compare case-insensitively (RFC 9110 section 8.3.1).
function mediaTypeOf(contentType: unknown): string {
  return typeof contentType === 'string'
    ? (contentType.split(';')[0] ?? '').trim().toLowerCase()
    : '';
}

// A JSON body read for what it is, or nothing for anything else.
export function jsonBodyOf(contentType: unknown, text: string): unknown {
  if (text.length === 0) return null;
  if (!JSON_MEDIA_TYPE.test(mediaTypeOf(contentType))) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return null;
  }
}
