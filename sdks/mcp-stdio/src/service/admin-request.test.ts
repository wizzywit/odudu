import { describe, expect, it } from 'vitest';
import {
  ADMIN_BODY_CAP_BYTES,
  createOnlyOf,
  idempotencyKeyOf,
  jsonBodyOf,
  payloadOf,
  preconditionOf,
  preflight,
  REQUEST_BODY_CAP_BYTES,
  returnedHeaders,
} from '#/service/admin-request';
import { ToolProblem, type AdminRequestSpec } from '#/service/tool';

const base: AdminRequestSpec = { method: 'PATCH', pattern: '/p', params: {}, query: {} };
const ETAG = `"${'a'.repeat(8)}"`;

describe('the parts of an admin request a tool may set', () => {
  it('sends a body as JSON on a PATCH, POST or PUT, within its cap', () => {
    expect(payloadOf({ ...base, body: { a: 1 } })).toBe('{"a":1}');
    expect(payloadOf(base)).toBeUndefined();
    expect(() => payloadOf({ ...base, method: 'GET', body: {} })).toThrow(/carries a body/u);
    expect(() => payloadOf({ ...base, body: { a: 'x'.repeat(REQUEST_BODY_CAP_BYTES) } })).toThrow(
      /too large/u,
    );
    expect(() => payloadOf({ ...base, bodyCap: ADMIN_BODY_CAP_BYTES + 1, body: {} })).toThrow();
  });

  it('allows one strong etag as a precondition, on a write that replaces', () => {
    expect(preconditionOf({ ...base, ifMatch: ETAG })).toBe(ETAG);
    expect(() => preconditionOf({ ...base, ifMatch: `W/${ETAG}` })).toThrow(/strong/u);
    expect(() => preconditionOf({ ...base, method: 'POST', ifMatch: ETAG })).toThrow();
  });

  it('allows create-only on a PUT with no etag', () => {
    expect(createOnlyOf({ ...base, method: 'PUT', createOnly: true })).toBe(true);
    expect(() => createOnlyOf({ ...base, createOnly: true })).toThrow();
    expect(() => createOnlyOf({ ...base, method: 'PUT', createOnly: true, ifMatch: ETAG })).toThrow(
      /not both/u,
    );
  });

  it('asks a POST for a key of its own and no other method', () => {
    expect(idempotencyKeyOf({ ...base, method: 'POST', idempotencyKey: 'k-1' })).toBe('k-1');
    expect(() => idempotencyKeyOf({ ...base, method: 'POST' })).toThrow();
    expect(() => idempotencyKeyOf({ ...base, idempotencyKey: 'k-1' })).toThrow();
  });

  it('says a request it refuses to build as a refusal of the arguments', () => {
    expect(() =>
      preflight(() => {
        throw new Error('nope');
      }),
    ).toThrow(ToolProblem);
  });

  it('keeps three response headers and a JSON body of any +json type', () => {
    expect(returnedHeaders({ etag: ETAG, 'set-cookie': 'a=1', 'retry-after': '3' })).toEqual({
      etag: ETAG,
      'retry-after': '3',
    });
    expect(jsonBodyOf('application/problem+json; charset=utf-8', '{"a":1}')).toEqual({ a: 1 });
    expect(jsonBodyOf('text/html', '{"a":1}')).toBeNull();
    expect(jsonBodyOf('application/json', '{')).toBeNull();
    expect(jsonBodyOf('application/json', '')).toBeNull();
  });
});
