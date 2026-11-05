import { describe, expect, it } from 'vitest';
import {
  atCapacity,
  fingerprintOf,
  IDEMPOTENCY_MAX_LIVE_KEYS,
  IDEMPOTENCY_MAX_BODY_BYTES,
  idempotencyKeyOf,
  idempotentMethod,
  principalFingerprint,
  replayedHeaders,
  requestMatches,
  responseVerdict,
} from '#/service/idempotency';

describe('fingerprintOf', () => {
  it('is a SHA-256 hex digest', () => {
    expect(fingerprintOf('POST', '/a', { x: 1 })).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('does not depend on the order of a body’s members, at any depth', () => {
    const one = fingerprintOf('POST', '/a', { a: 1, b: { c: 2, d: [{ e: 1, f: 2 }] } });
    const two = fingerprintOf('POST', '/a', { b: { d: [{ f: 2, e: 1 }], c: 2 }, a: 1 });
    expect(one).toBe(two);
  });

  it('differs when the method, the path or any value differs', () => {
    const base = fingerprintOf('POST', '/a', { x: 1 });
    expect(fingerprintOf('PUT', '/a', { x: 1 })).not.toBe(base);
    expect(fingerprintOf('POST', '/b', { x: 1 })).not.toBe(base);
    expect(fingerprintOf('POST', '/a', { x: 2 })).not.toBe(base);
    expect(fingerprintOf('POST', '/a', { x: '1' })).not.toBe(base);
  });

  it('keeps an array’s order, which is part of its meaning', () => {
    expect(fingerprintOf('POST', '/a', [1, 2])).not.toBe(fingerprintOf('POST', '/a', [2, 1]));
  });

  it('is not fooled by a method and a path that run into each other', () => {
    expect(fingerprintOf('POST', '/a', null)).not.toBe(fingerprintOf('POS', 'T/a', null));
  });

  it('counts a member named __proto__ as data', () => {
    const withKey = JSON.parse('{"__proto__": {"admin": true}, "a": 1}') as unknown;
    expect(fingerprintOf('POST', '/a', withKey)).not.toBe(fingerprintOf('POST', '/a', { a: 1 }));
  });

  it('tells an absent body from an empty object', () => {
    expect(fingerprintOf('POST', '/a', undefined)).not.toBe(fingerprintOf('POST', '/a', {}));
  });

  it('hashes the bytes of a raw body', () => {
    const one = fingerprintOf('POST', '/a', Buffer.from('abc'));
    expect(fingerprintOf('POST', '/a', Buffer.from('abc'))).toBe(one);
    expect(fingerprintOf('POST', '/a', Buffer.from('abd'))).not.toBe(one);
  });
});

describe('principalFingerprint', () => {
  const fingerprint = fingerprintOf('POST', '/a', { x: 1 });

  it('differs for a different caller, and for an agent acting for the same subject', () => {
    const owner = { subjectId: 's1', issuerTenantId: 't1' };
    const base = principalFingerprint(owner, fingerprint);
    expect(principalFingerprint({ subjectId: 's2', issuerTenantId: 't1' }, fingerprint)).not.toBe(
      base,
    );
    expect(principalFingerprint({ subjectId: 's1', issuerTenantId: 't2' }, fingerprint)).not.toBe(
      base,
    );
    expect(principalFingerprint({ ...owner, agentClientId: 'agent' }, fingerprint)).not.toBe(base);
  });

  it('is stable for the same caller', () => {
    const caller = { subjectId: 's1', issuerTenantId: 't1', agentClientId: 'agent' };
    expect(principalFingerprint(caller, fingerprint)).toBe(
      principalFingerprint(caller, fingerprint),
    );
  });
});

describe('idempotencyKeyOf', () => {
  it('reads an absent header as absent', () => {
    expect(idempotencyKeyOf(undefined)).toEqual({ kind: 'absent' });
  });

  it('accepts a UUID, a ULID and a plain token', () => {
    for (const key of [
      '2f5c1d7e-9a3b-4c8e-8f10-0a1b2c3d4e5f',
      '01JABCDEFGHJKMNPQRSTVWXYZ0',
      'a_b-c.d:e',
    ]) {
      expect(idempotencyKeyOf(key)).toEqual({ kind: 'valid', key });
    }
  });

  it('refuses an empty key, one over 255 characters, other characters, and a repeated header', () => {
    expect(idempotencyKeyOf('')).toEqual({ kind: 'invalid' });
    expect(idempotencyKeyOf('a'.repeat(256))).toEqual({ kind: 'invalid' });
    expect(idempotencyKeyOf('a'.repeat(255))).toEqual({ kind: 'valid', key: 'a'.repeat(255) });
    for (const key of ['has space', 'new\nline', 'café', 'a/b', '"quoted"']) {
      expect(idempotencyKeyOf(key)).toEqual({ kind: 'invalid' });
    }
    expect(idempotencyKeyOf(['a', 'b'])).toEqual({ kind: 'invalid' });
  });
});

describe('idempotentMethod', () => {
  it('is true for a POST only: PUT, PATCH and DELETE are idempotent already', () => {
    expect(idempotentMethod('POST')).toBe(true);
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      expect(idempotentMethod(method)).toBe(false);
    }
  });
});

describe('responseVerdict', () => {
  it('stores a success within the cap', () => {
    expect(responseVerdict(201, '{"a":1}')).toBe('store');
    expect(responseVerdict(202, '')).toBe('store');
  });

  it('stores nothing for a refusal or a failure, so a retry runs again', () => {
    for (const status of [400, 403, 404, 409, 422, 429, 500, 503]) {
      expect(responseVerdict(status, '{}')).toBe('skip');
    }
  });

  it('keeps nothing of a call that ran outside the transaction, whatever its size', () => {
    expect(responseVerdict(201, '{}', false)).toBe('skip');
    expect(responseVerdict(200, 'a'.repeat(IDEMPOTENCY_MAX_BODY_BYTES + 1), false)).toBe('skip');
  });

  it('refuses a body over the cap, counted in bytes', () => {
    expect(responseVerdict(200, 'a'.repeat(IDEMPOTENCY_MAX_BODY_BYTES))).toBe('store');
    expect(responseVerdict(200, 'a'.repeat(IDEMPOTENCY_MAX_BODY_BYTES + 1))).toBe('too_large');
    expect(responseVerdict(200, 'é'.repeat(IDEMPOTENCY_MAX_BODY_BYTES / 2 + 1))).toBe('too_large');
  });
});

describe('replayedHeaders', () => {
  it('keeps the headers a client reads from a response and drops the rest', () => {
    expect(
      replayedHeaders({
        'content-type': 'application/json; charset=utf-8',
        etag: '"x"',
        location: '/y',
        'retry-after': '3',
        'set-cookie': 'a=b',
        'content-length': '12',
        'x-request-id': 'r',
        'cache-control': 'no-store',
      }),
    ).toEqual({
      'content-type': 'application/json; charset=utf-8',
      etag: '"x"',
      location: '/y',
      'retry-after': '3',
    });
  });

  it('keeps only string values', () => {
    expect(
      replayedHeaders({ etag: ['a', 'b'], location: 5, 'content-type': 'text/plain' }),
    ).toEqual({ 'content-type': 'text/plain' });
  });
});

describe('requestMatches and atCapacity', () => {
  it('compares fingerprints exactly', () => {
    expect(requestMatches('a', 'a')).toBe(true);
    expect(requestMatches('a', 'b')).toBe(false);
  });

  it('is full at the ceiling, not below it', () => {
    expect(atCapacity(IDEMPOTENCY_MAX_LIVE_KEYS - 1)).toBe(false);
    expect(atCapacity(IDEMPOTENCY_MAX_LIVE_KEYS)).toBe(true);
  });
});
