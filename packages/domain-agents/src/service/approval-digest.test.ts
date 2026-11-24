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

  it('omits an undefined member as JSON does', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
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
