import { describe, expect, it } from 'vitest';
import { parseRows, readingNoteHeadings } from '#/parse';

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
    const { rows } = parseRows('rfc7636.md', TABLE);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      clause: '4.1',
      level: 'MUST',
      testId: 'RFC7636-4.1-01',
      status: { kind: 'covered' },
    });
  });

  it('reads a gap as having no test id', () => {
    const { rows } = parseRows('rfc7636.md', TABLE);
    expect(rows[1]).toMatchObject({ testId: null, status: { kind: 'gap' } });
  });

  it('captures the phase and reason from a deferred status', () => {
    const { rows } = parseRows('rfc7636.md', TABLE);
    expect(nth(rows, 2).status).toEqual({
      kind: 'deferred',
      phase: 'P3',
      reason: 'needs client config',
    });
  });

  it('captures the reason from an n/a status', () => {
    const { rows } = parseRows('rfc7636.md', TABLE);
    expect(nth(rows, 3).status).toEqual({
      kind: 'na',
      reason: 'implicit removed in OAuth 2.1',
    });
  });

  it('captures the reference from a documented status', () => {
    const table = TABLE.replace(
      '| 4.4.1 | MUST | plain is rejected | — | gap |',
      '| 4.4.1 | SHOULD | the server documents its defaults | — | documented: see "The default scope" above |',
    );
    expect(nth(parseRows('rfc7636.md', table).rows, 1).status).toEqual({
      kind: 'documented',
      reference: 'see "The default scope" above',
    });
  });

  it('reports a documented status with nothing after the colon, and reads no row for it', () => {
    const bad = TABLE.replace('| — | gap |', '| — | documented: |');
    const { rows, errors } = parseRows('rfc7636.md', bad);
    expect(rows).toHaveLength(3);
    expect(errors).toEqual([expect.stringMatching(/documented/)]);
  });

  it('captures the reference from an accepted status', () => {
    const table = TABLE.replace(
      '| — | gap |',
      '| — | accepted: see "TLS: what a boot guard settles" — the proxy terminates TLS |',
    );
    expect(nth(parseRows('rfc7636.md', table).rows, 1).status).toEqual({
      kind: 'accepted',
      reference: 'see "TLS: what a boot guard settles" — the proxy terminates TLS',
    });
  });

  it('reports an accepted status with nothing after the colon, and reads no row for it', () => {
    const bad = TABLE.replace('| — | gap |', '| — | accepted: |');
    const { rows, errors } = parseRows('rfc7636.md', bad);
    expect(rows).toHaveLength(3);
    expect(errors).toEqual([expect.stringMatching(/accepted/)]);
  });

  it('reports a status it does not recognise rather than ignoring the row', () => {
    const bad = TABLE.replace('| covered |', '| probably fine |');
    const { rows, errors } = parseRows('rfc7636.md', bad);
    expect(rows).toHaveLength(3);
    expect(errors).toEqual([expect.stringMatching(/probably fine/)]);
  });

  it('reports a covered row with no test id, and reads no row for it', () => {
    const bad = TABLE.replace('| `RFC7636-4.1-01` | covered |', '| — | covered |');
    const { rows, errors } = parseRows('rfc7636.md', bad);
    expect(rows).toHaveLength(3);
    expect(errors).toEqual([expect.stringMatching(/covered.*test id/i)]);
  });

  it('reports rather than silently dropping a clause row with an escaped pipe', () => {
    const bad = TABLE.replace(
      '| 4.4.1 | MUST | plain is rejected | — | gap |',
      '| 4.4.1 | MUST | plain is rejected \\| escaped | — | gap |',
    );
    const { rows, errors } = parseRows('rfc7636.md', bad);
    expect(rows).toHaveLength(3);
    expect(errors).toEqual([expect.stringMatching(/rfc7636\.md:\d+.*6 cells/)]);
  });

  it('reports an unrecognised level inside the clause table', () => {
    const bad = TABLE.replace('| 4.2 | SHOULD |', '| 4.2 | SHOULDNT |');
    const { rows, errors } = parseRows('rfc7636.md', bad);
    expect(rows).toHaveLength(3);
    expect(errors).toEqual([expect.stringMatching(/rfc7636\.md:\d+.*SHOULDNT/)]);
  });

  it('collects every malformed row in one pass rather than stopping at the first', () => {
    const bad = TABLE.replace('| 4.2 | SHOULD |', '| 4.2 | SHOULDNT |').replace(
      '| — | gap |',
      '| — | bogus-status |',
    );
    const { rows, errors } = parseRows('rfc7636.md', bad);
    expect(rows).toHaveLength(2);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/bogus-status/);
    expect(errors[1]).toMatch(/SHOULDNT/);
  });

  it('skips a legitimate non-clause table elsewhere in the file without error', () => {
    const withNotesTable = `${TABLE}\n## Reading notes\n\n| Term | Meaning |\n| ---- | ------- |\n| PKCE | Proof Key for Code Exchange |\n`;
    const { rows, errors } = parseRows('rfc7636.md', withNotesTable);
    expect(rows).toHaveLength(4);
    expect(errors).toEqual([]);
  });
});

describe('readingNoteHeadings', () => {
  it('collects every heading a documented row could point at', () => {
    const markdown = '# RFC 7636\n\n## Reading notes\n\n### The default scope\n\ntext\n';
    expect(readingNoteHeadings(markdown)).toEqual(
      new Set(['RFC 7636', 'Reading notes', 'The default scope']),
    );
  });

  it('does not mistake a hash inside a table row for a heading', () => {
    expect(readingNoteHeadings('| 4.1 | MUST | # not a heading | — | gap |\n')).toEqual(new Set());
  });
});
