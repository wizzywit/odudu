import { describe, expect, it } from 'vitest';
import { idempotencyKeyOf as adminKeyOf } from '@odudu/protocol-admin';
import {
  ADMIN_BODY_CAP_BYTES,
  IDEMPOTENCY_KEY_PATTERN,
  REQUEST_BODY_CAP_BYTES,
  idempotencyKeyOf,
  jsonBodyOf,
  payloadOf,
  preconditionOf,
} from '#/service/admin-request';
import type { AdminMethod, AdminRequestSpec } from '#/service/tool';

function spec(method: AdminMethod, rest: Partial<AdminRequestSpec> = {}): AdminRequestSpec {
  return { method, pattern: '/admin/tenants/:tenant/roles', params: {}, query: {}, ...rest };
}

describe('the bytes of a body', () => {
  it.each<AdminMethod>(['PATCH', 'POST', 'PUT'])('a %s carries a JSON record', (method) => {
    expect(payloadOf(spec(method, { body: { name: 'x' } }))).toBe('{"name":"x"}');
  });

  it.each<AdminMethod>(['GET', 'DELETE'])('a %s carries none', (method) => {
    expect(payloadOf(spec(method))).toBeUndefined();
    expect(() => payloadOf(spec(method, { body: {} }))).toThrow(/PATCH, POST or PUT/u);
  });

  it('is a record, within the cap the tool names and never above the read cap', () => {
    const big = { text: 'x'.repeat(100_000) };
    expect(() => payloadOf(spec('POST', { body: big }))).toThrow(/too large/u);
    expect(payloadOf(spec('PUT', { body: big, bodyCap: 200_000 }))).toContain('xxxx');
    expect(() => payloadOf(spec('PUT', { body: big, bodyCap: 50 }))).toThrow(/too large/u);
    expect(ADMIN_BODY_CAP_BYTES).toBe(1_048_576);
    expect(REQUEST_BODY_CAP_BYTES).toBe(65_536);
    for (const bodyCap of [ADMIN_BODY_CAP_BYTES + 1, 0, -1, 1.5, Number.NaN]) {
      expect(() => payloadOf(spec('PUT', { body: { a: 'b' }, bodyCap })), String(bodyCap)).toThrow(
        /cap/u,
      );
    }
  });
});

describe('the precondition and the key of a write', () => {
  const etag = `"${'a'.repeat(64)}"`;

  it.each<AdminMethod>(['PATCH', 'PUT', 'DELETE'])('a %s takes one strong etag', (method) => {
    expect(preconditionOf(spec(method, { ifMatch: etag }))).toBe(etag);
    expect(() => preconditionOf(spec(method, { ifMatch: 'W/"x"' }))).toThrow(/strong/u);
  });

  it.each<AdminMethod>(['GET', 'POST'])('a %s takes none', (method) => {
    expect(() => preconditionOf(spec(method, { ifMatch: etag }))).toThrow(/PATCH, PUT or DELETE/u);
  });

  it('a POST names a key of 1 to 255 of the characters the admin API accepts', () => {
    for (const key of ['a', 'role-1', 'A_b.c:d-9', 'k'.repeat(255)]) {
      expect(idempotencyKeyOf(spec('POST', { idempotencyKey: key }))).toBe(key);
    }
    for (const key of [
      '',
      'has space',
      'line\nbreak',
      'k\r\nx-evil: 1',
      'k'.repeat(256),
      'é',
      '/',
    ]) {
      expect(() => idempotencyKeyOf(spec('POST', { idempotencyKey: key })), key).toThrow(/key/u);
    }
  });

  it('a POST without a key is refused, and no other method takes one', () => {
    expect(() => idempotencyKeyOf(spec('POST'))).toThrow(/key/u);
    for (const method of ['GET', 'PATCH', 'PUT', 'DELETE'] as const) {
      expect(idempotencyKeyOf(spec(method))).toBeUndefined();
      expect(() => idempotencyKeyOf(spec(method, { idempotencyKey: 'k' }))).toThrow(/POST/u);
    }
  });
});

describe('a body read as JSON', () => {
  it.each([
    'application/json',
    'Application/JSON',
    'application/json; charset=utf-8',
    'APPLICATION/JSON ;charset=UTF-8',
    'application/problem+json',
    'Application/Problem+JSON; charset=utf-8',
    'application/vnd.api+json',
  ])('is read when the type is %s', (type) => {
    expect(jsonBodyOf(type, '{"a":1}')).toEqual({ a: 1 });
  });

  it.each([
    'text/html',
    'text/plain; charset=json',
    'application/jsonp',
    'application/x-json-lines',
    '',
    undefined,
  ])('is not read when the type is %j', (type) => {
    expect(jsonBodyOf(type, '{"a":1}')).toBeNull();
  });

  it('is nothing for an empty or malformed body', () => {
    expect(jsonBodyOf('application/json', '')).toBeNull();
    expect(jsonBodyOf('application/json', '{')).toBeNull();
  });
});

describe('the idempotency key pattern', () => {
  it('accepts exactly what the admin API accepts', () => {
    const samples = [
      'a',
      'A_b.c:d-9',
      'k'.repeat(255),
      'k'.repeat(256),
      '',
      ' ',
      'a b',
      'a\n',
      'a\r\nx',
      'a/b',
      'a"b',
      'é',
      'a\u0000',
      'a~b',
      'a,b',
      'a;b',
      '-',
      '.',
      ':',
      '_',
      '0',
    ];
    for (const sample of samples) {
      expect(IDEMPOTENCY_KEY_PATTERN.test(sample), JSON.stringify(sample)).toBe(
        adminKeyOf(sample).kind === 'valid',
      );
    }
  });
});
