import { isEtag } from '#/service/etag-shape';
import type { AdminRequestSpec } from '#/service/tool';

// What a call may read back: the admin API's own page size bounds rows, not
// bytes, and a model reads whatever is returned.
export const ADMIN_BODY_CAP_BYTES = 1_048_576;

// What a tool may send: a description or a name is short, and the admin API
// has its own bound, so this is only a stop on what leaves this layer.
export const REQUEST_BODY_CAP_BYTES = 65_536;

export const RETURNED_HEADERS = ['content-type', 'etag', 'retry-after'] as const;

// The bytes of a request body, or nothing for a call without one. A body is a
// JSON record on a PATCH and nothing else.
export function payloadOf(req: AdminRequestSpec): string | undefined {
  if (req.body === undefined) return undefined;
  if (req.method !== 'PATCH') throw new Error('only a PATCH carries a body');
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('a body is a JSON record');
  }
  const payload = JSON.stringify(req.body);
  if (Buffer.byteLength(payload) > REQUEST_BODY_CAP_BYTES) {
    throw new Error('the request body is too large');
  }
  return payload;
}

// The precondition of a write: one strong etag, and only on a PATCH.
export function preconditionOf(req: AdminRequestSpec): string | undefined {
  if (req.ifMatch === undefined) return undefined;
  if (req.method !== 'PATCH') throw new Error('only a PATCH carries a precondition');
  if (!isEtag(req.ifMatch)) throw new Error('a precondition is one strong entity tag');
  return req.ifMatch;
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

// A JSON body read for what it is, or nothing for anything else.
export function jsonBodyOf(contentType: unknown, text: string): unknown {
  if (text.length === 0) return null;
  if (!String(contentType).includes('json')) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return null;
  }
}
