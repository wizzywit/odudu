import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSuite } from '#/suite';

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
