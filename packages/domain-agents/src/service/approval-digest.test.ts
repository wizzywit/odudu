import { describe, expect, it } from 'vitest';
import { approvalDigest, canonicalJson } from '#/service/approval-digest';

const base = {
  name: 'delete_client',
  input: { id: 'c1', options: { force: true, reason: 'cleanup' } },
  tenantId: 't1',
  ownerSubjectId: 'o1',
  instanceId: 'i1' as string | null,
};

describe('canonicalJson', () => {
  it('sorts keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: [3, { z: 1, a: 2 }], a: null })).toBe(
      '{"a":null,"b":[3,{"a":2,"z":1}]}',
    );
  });

  it('writes no whitespace and escapes like JSON', () => {
    expect(canonicalJson({ k: 'a "b"\n' })).toBe('{"k":"a \\"b\\"\\n"}');
  });
});

describe('approvalDigest', () => {
  it('is 64 hex characters', () => {
    expect(approvalDigest(base)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('is equal for reordered keys at any depth', () => {
    const reordered = {
      instanceId: 'i1',
      ownerSubjectId: 'o1',
      tenantId: 't1',
      input: { options: { reason: 'cleanup', force: true }, id: 'c1' },
      name: 'delete_client',
    };
    expect(approvalDigest(reordered)).toBe(approvalDigest(base));
  });

  it.each([
    ['name', { name: 'delete_group' }],
    ['input', { input: { id: 'c2', options: { force: true, reason: 'cleanup' } } }],
    ['nested input', { input: { id: 'c1', options: { force: false, reason: 'cleanup' } } }],
    ['tenantId', { tenantId: 't2' }],
    ['ownerSubjectId', { ownerSubjectId: 'o2' }],
    ['instanceId', { instanceId: 'i2' }],
    ['a missing instance', { instanceId: null }],
  ])('differs when the %s differs', (_, override) => {
    expect(approvalDigest({ ...base, ...override })).not.toBe(approvalDigest(base));
  });

  it('keeps array order significant', () => {
    expect(approvalDigest({ ...base, input: [1, 2] })).not.toBe(
      approvalDigest({ ...base, input: [2, 1] }),
    );
  });

  it('cannot be forged by moving text between fields', () => {
    const a = approvalDigest({ ...base, name: 'ab', tenantId: 'c' });
    const b = approvalDigest({ ...base, name: 'a', tenantId: 'bc' });
    expect(a).not.toBe(b);
  });
});

describe('canonicalJson on anything that is not plain JSON data', () => {
  class Thing {
    a = 1;
  }
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  let deep: unknown = 1;
  for (let i = 0; i < 70; i += 1) deep = [deep];

  it.each([
    ['a Date', new Date(0)],
    ['a Map', new Map()],
    ['a Set', new Set()],
    ['a class instance', new Thing()],
    ['a function', () => 1],
    ['a symbol', Symbol('s')],
    ['undefined', undefined],
    ['undefined in an object', { a: undefined }],
    ['undefined in an array', [undefined]],
    ['a BigInt', 1n],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['negative zero', -0],
    ['a nested Date', { a: [{ b: new Date(0) }] }],
    ['a cycle', cyclic],
    ['a structure deeper than the bound', deep],
  ])('throws on %s', (_, value) => {
    expect(() => canonicalJson(value)).toThrow(/not plain JSON data|cycle|deeper/u);
  });

  it('keeps positive zero', () => {
    expect(canonicalJson([0])).toBe('[0]');
  });

  it('accepts a shared, non-cyclic reference', () => {
    const shared = { x: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });
});

describe('a __proto__ member', () => {
  it('is kept as an ordinary key', () => {
    expect(canonicalJson(JSON.parse('{"a":1,"__proto__":{"x":1}}'))).toBe(
      '{"__proto__":{"x":1},"a":1}',
    );
  });

  it('is kept nested and with a primitive value', () => {
    expect(canonicalJson(JSON.parse('{"o":[{"__proto__":5}]}'))).toBe('{"o":[{"__proto__":5}]}');
  });

  it('changes the digest', () => {
    const withKey = { ...base, input: JSON.parse('{"a":1,"__proto__":{"x":1}}') as unknown };
    const without = { ...base, input: { a: 1 } };
    expect(approvalDigest(withKey)).not.toBe(approvalDigest(without));
    const primitive = { ...base, input: JSON.parse('{"a":1,"__proto__":2}') as unknown };
    expect(approvalDigest(primitive)).not.toBe(approvalDigest(without));
  });

  it('treats constructor and prototype as ordinary keys', () => {
    expect(canonicalJson(JSON.parse('{"prototype":1,"constructor":{"b":2}}'))).toBe(
      '{"constructor":{"b":2},"prototype":1}',
    );
  });
});
