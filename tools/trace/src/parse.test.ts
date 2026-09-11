import { describe, expect, it } from 'vitest';
import { parseRows } from '#/parse';

function nth<T>(arr: T[], i: number): T {
  const value = arr[i];
  if (value === undefined) throw new Error(`expected element ${String(i)} to exist`);
  return value;
}

const TABLE = `
# RFC 7636

| Clause | Level | Requirement | Test ID | Status |
| ------ | ----- | ----------- | ------- | ------ |
| 4.1 | MUST | verifier is 43-128 chars | \`RFC7636-4.1-01\` | covered |
| 4.4.1 | MUST | plain is rejected | — | gap |
| 4.2 | SHOULD | use S256 | \`RFC7636-4.2-01\` | deferred: P3 — needs client config |
| 7.2 | MUST | downgrade prevention | — | n/a: implicit removed in OAuth 2.1 |
`;

describe('parseRows', () => {
  it('reads clause, level and test id', () => {
    const rows = parseRows('rfc7636.md', TABLE);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      clause: '4.1',
      level: 'MUST',
      testId: 'RFC7636-4.1-01',
      status: { kind: 'covered' },
    });
  });

  it('reads a gap as having no test id', () => {
    const rows = parseRows('rfc7636.md', TABLE);
    expect(rows[1]).toMatchObject({ testId: null, status: { kind: 'gap' } });
  });

  it('captures the phase and reason from a deferred status', () => {
    const rows = parseRows('rfc7636.md', TABLE);
    expect(nth(rows, 2).status).toEqual({
      kind: 'deferred',
      phase: 'P3',
      reason: 'needs client config',
    });
  });

  it('captures the reason from an n/a status', () => {
    const rows = parseRows('rfc7636.md', TABLE);
    expect(nth(rows, 3).status).toEqual({
      kind: 'na',
      reason: 'implicit removed in OAuth 2.1',
    });
  });

  it('rejects a status it does not recognise rather than ignoring the row', () => {
    const bad = TABLE.replace('| covered |', '| probably fine |');
    expect(() => parseRows('rfc7636.md', bad)).toThrow(/probably fine/);
  });

  it('rejects a covered row with no test id', () => {
    const bad = TABLE.replace('| `RFC7636-4.1-01` | covered |', '| — | covered |');
    expect(() => parseRows('rfc7636.md', bad)).toThrow(/covered.*test id/i);
  });
});
