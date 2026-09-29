import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isSpecificationId, readSuite, readSuites } from '#/suite';

function report(assertionResults: { fullName: string; status: string }[]): unknown {
  return { testResults: [{ assertionResults }] };
}

let dir: string | undefined;

async function reportFile(contents: unknown): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'odudu-trace-'));
  const path = join(dir, 'report.json');
  await writeFile(path, JSON.stringify(contents));
  return path;
}

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('readSuite — id extraction', () => {
  it('reads the single id carried by an untested title', async () => {
    const path = await reportFile(
      report([{ fullName: '[RFC7636-4.1-01] verifier length is enforced', status: 'passed' }]),
    );
    expect(await readSuite(path)).toEqual([
      {
        id: 'RFC7636-4.1-01',
        title: '[RFC7636-4.1-01] verifier length is enforced',
        passed: true,
      },
    ]);
  });

  it('attributes a test with no bracketed id to nothing, rather than throwing', async () => {
    const path = await reportFile(
      report([{ fullName: 'a plain describe with no id at all', status: 'passed' }]),
    );
    expect(await readSuite(path)).toEqual([]);
  });

  it('attributes a describe nested inside another id to the inner (innermost) id, not the outer one', async () => {
    // fullName as vitest's JSON reporter produces it: every ancestor
    // describe title concatenated with the test's own title, outermost
    // first — exactly the shape a describe-inside-a-described id produces.
    const path = await reportFile(
      report([
        {
          fullName:
            '[OUTER-1-01] the outer group [INNER-2-02] the inner group proves its own clause',
          status: 'passed',
        },
      ]),
    );
    expect(await readSuite(path)).toEqual([
      {
        id: 'INNER-2-02',
        title: '[OUTER-1-01] the outer group [INNER-2-02] the inner group proves its own clause',
        passed: true,
      },
    ]);
  });

  it('keeps a failing test failing after id extraction', async () => {
    const path = await reportFile(
      report([{ fullName: '[RFC7636-4.1-01] verifier length is enforced', status: 'failed' }]),
    );
    expect(await readSuite(path)).toEqual([
      {
        id: 'RFC7636-4.1-01',
        title: '[RFC7636-4.1-01] verifier length is enforced',
        passed: false,
      },
    ]);
  });
});

describe('isSpecificationId', () => {
  it('treats an RFC-style id as a specification id', () => {
    expect(isSpecificationId('RFC7636-4.1-01')).toBe(true);
  });

  it('treats an OIDC-style id as a specification id', () => {
    expect(isSpecificationId('OIDC-CORE-3.1.2.1-02')).toBe(true);
  });

  it('treats an ODUDU-prefixed id as a project id, not a specification id', () => {
    expect(isSpecificationId('ODUDU-CROSS-TENANT-LEAKAGE-01')).toBe(false);
  });
});

describe('readSuites', () => {
  it('merges several reports, in input order', async () => {
    dir = await mkdtemp(join(tmpdir(), 'odudu-trace-'));
    const a = join(dir, 'a.json');
    const b = join(dir, 'b.json');
    await writeFile(
      a,
      JSON.stringify(report([{ fullName: '[RFC7636-4.1-01] a', status: 'passed' }])),
    );
    await writeFile(
      b,
      JSON.stringify(report([{ fullName: '[RFC6749-3.1-01] b', status: 'failed' }])),
    );

    expect(await readSuites([a, b])).toEqual([
      { id: 'RFC7636-4.1-01', title: '[RFC7636-4.1-01] a', passed: true },
      { id: 'RFC6749-3.1-01', title: '[RFC6749-3.1-01] b', passed: false },
    ]);
  });

  it('rejects naming a report that is missing', async () => {
    dir = await mkdtemp(join(tmpdir(), 'odudu-trace-'));
    const missing = join(dir, 'absent', 'trace-report.json');

    await expect(readSuites([missing])).rejects.toThrow(missing);
  });
});
