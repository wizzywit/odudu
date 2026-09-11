import { describe, expect, it } from 'vitest';
import { reconcile } from '#/reconcile';
import { type Row } from '#/parse';

function nth<T>(arr: T[], i: number): T {
  const value = arr[i];
  if (value === undefined) throw new Error(`expected element ${String(i)} to exist`);
  return value;
}

const row = (over: Partial<Row>): Row => ({
  file: 'rfc7636.md',
  clause: '4.1',
  level: 'MUST',
  requirement: 'r',
  testId: 'RFC7636-4.1-01',
  status: { kind: 'covered' },
  ...over,
});

describe('reconcile', () => {
  it('is silent when a covered row has a passing test', () => {
    const findings = reconcile(
      [row({})],
      [{ id: 'RFC7636-4.1-01', title: '[RFC7636-4.1-01] verifier length', passed: true }],
    );
    expect(findings).toEqual([]);
  });

  it('errors when a covered row references a test that does not exist', () => {
    const findings = reconcile([row({})], []);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'error' });
    expect(nth(findings, 0).message).toMatch(/no test/i);
  });

  it('errors when the referenced test failed', () => {
    const findings = reconcile(
      [row({})],
      [{ id: 'RFC7636-4.1-01', title: '[RFC7636-4.1-01] x', passed: false }],
    );
    expect(findings[0]).toMatchObject({ severity: 'error' });
    expect(nth(findings, 0).message).toMatch(/failed/i);
  });

  it('warns rather than errors on a MUST gap by default', () => {
    const findings = reconcile([row({ testId: null, status: { kind: 'gap' } })], []);
    expect(findings[0]).toMatchObject({ severity: 'warn' });
  });

  it('errors on a MUST gap in strict mode', () => {
    const findings = reconcile([row({ testId: null, status: { kind: 'gap' } })], [], {
      strict: true,
    });
    expect(findings[0]).toMatchObject({ severity: 'error' });
  });

  it('ignores deferred and n/a rows entirely', () => {
    const findings = reconcile(
      [
        row({ testId: null, status: { kind: 'deferred', phase: 'P3', reason: 'r' } }),
        row({ testId: null, status: { kind: 'na', reason: 'r' } }),
      ],
      [],
      { strict: true },
    );
    expect(findings).toEqual([]);
  });
});
