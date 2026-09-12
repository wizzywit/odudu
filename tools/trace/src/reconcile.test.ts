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

  it('errors when a test title carries a specification-style id that matches no row', () => {
    const findings = reconcile(
      [row({})],
      [
        { id: 'RFC7636-4.1-01', title: '[RFC7636-4.1-01] verifier length', passed: true },
        { id: 'RFC9999-1-01', title: '[RFC9999-1-01] an orphan clause id', passed: true },
      ],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'error' });
    expect(nth(findings, 0).message).toMatch(/RFC9999-1-01/);
  });

  it('ignores an orphan test id in the project namespace', () => {
    const findings = reconcile(
      [row({})],
      [
        { id: 'RFC7636-4.1-01', title: '[RFC7636-4.1-01] verifier length', passed: true },
        {
          id: 'ODUDU-SOME-PROPERTY-01',
          title: '[ODUDU-SOME-PROPERTY-01] a project id',
          passed: true,
        },
      ],
    );
    expect(findings).toEqual([]);
  });

  it('is silent when a specification-style test id matches a row', () => {
    const findings = reconcile(
      [row({})],
      [{ id: 'RFC7636-4.1-01', title: '[RFC7636-4.1-01] verifier length', passed: true }],
    );
    expect(findings).toEqual([]);
  });

  // `documented:` is a promise that prose exists. A promise nothing checks
  // is what this phase kept getting bitten by, so the reference has to name
  // a heading the file actually carries.
  describe('a documented row', () => {
    const documented = (reference: string, over: Partial<Row> = {}): Row =>
      row({ testId: null, level: 'SHOULD', status: { kind: 'documented', reference }, ...over });
    const headings = new Map([['rfc7636.md', new Set(['The default scope'])]]);

    it('is silent when its reference quotes a heading of its own file', () => {
      expect(
        reconcile([documented('see "The default scope" above')], [], { headings, strict: true }),
      ).toEqual([]);
    });

    it('errors when its reference quotes a heading that is not there', () => {
      const findings = reconcile([documented('see "The nonexistent note" above')], [], {
        headings,
      });
      expect(findings[0]).toMatchObject({ severity: 'error' });
      expect(nth(findings, 0).message).toMatch(/nonexistent note/);
    });

    it('errors when its reference quotes no heading at all', () => {
      const findings = reconcile([documented('it is written down somewhere')], [], { headings });
      expect(findings[0]).toMatchObject({ severity: 'error' });
      expect(nth(findings, 0).message).toMatch(/heading/i);
    });

    // Prose is an answer to "documents its own behaviour", which is what a
    // SHOULD of that shape asks for. A MUST discharged by prose alone is the
    // shape of every defect this table exists to stop.
    it('warns when a MUST is discharged by prose alone', () => {
      const findings = reconcile(
        [documented('see "The default scope" above', { level: 'MUST' })],
        [],
        { headings },
      );
      expect(findings[0]).toMatchObject({ severity: 'warn' });
      expect(nth(findings, 0).message).toMatch(/MUST/);
    });

    it('errors on that MUST in strict mode', () => {
      const findings = reconcile(
        [documented('see "The default scope" above', { level: 'MUST' })],
        [],
        { headings, strict: true },
      );
      expect(findings[0]).toMatchObject({ severity: 'error' });
    });
  });

  // A `describe('[ID] ...')` holding several `it`s reports one result per
  // `it`, every one of them carrying that id, so an id naming several
  // results is the ordinary case rather than a mistake. Reducing them to one
  // result per id lets a green sibling hide a red one.
  describe('an id carried by several test results', () => {
    const passing = { id: 'RFC7636-4.1-01', title: '[RFC7636-4.1-01] a sibling that passes' };
    const failing = { id: 'RFC7636-4.1-01', title: '[RFC7636-4.1-01] the one that fails' };

    it('is silent when every result carrying it passed', () => {
      expect(
        reconcile(
          [row({})],
          [
            { ...passing, passed: true },
            { ...failing, passed: true },
          ],
        ),
      ).toEqual([]);
    });

    it('errors when the failing result came first', () => {
      const findings = reconcile(
        [row({})],
        [
          { ...failing, passed: false },
          { ...passing, passed: true },
        ],
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ severity: 'error' });
      expect(nth(findings, 0).message).toMatch(/failed/i);
    });

    it('errors when the failing result came last', () => {
      const findings = reconcile(
        [row({})],
        [
          { ...passing, passed: true },
          { ...failing, passed: false },
        ],
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ severity: 'error' });
    });

    it('names the failing result rather than a passing sibling', () => {
      const findings = reconcile(
        [row({})],
        [
          { ...failing, passed: false },
          { ...passing, passed: true },
        ],
      );
      expect(nth(findings, 0).message).toContain('the one that fails');
      expect(nth(findings, 0).message).not.toContain('a sibling that passes');
    });

    it('reports every row the id covers, not just the first', () => {
      const findings = reconcile(
        [row({ clause: '4.1' }), row({ clause: '4.4' })],
        [{ ...failing, passed: false }],
      );
      expect(findings).toHaveLength(2);
      expect(findings.map((f) => f.row?.clause)).toEqual(['4.1', '4.4']);
    });
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
