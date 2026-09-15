import { readFile } from 'node:fs/promises';

export interface TestResult {
  id: string;
  title: string;
  passed: boolean;
}

const ID_IN_TITLE = /\[([A-Z0-9]+(?:-[A-Za-z0-9.]+)+)\]/gu;

// A test id names either a specification clause (traceable to a
// docs/protocols row: `RFC6749-...`, `OIDC-CORE-...`, `JOSE-...`, ...) or an
// Odudu-only property that no specification imposes. The `ODUDU-` prefix is
// the entire boundary: anything else is treated as a specification id and
// must resolve to a row, on pain of failing the build.
const PROJECT_ID_PREFIX = 'ODUDU-';

export function isSpecificationId(id: string): boolean {
  return !id.startsWith(PROJECT_ID_PREFIX);
}

// `fullName` concatenates every ancestor describe title with the test's own
// title, outermost first. A describe nested inside one that already carries
// an id carries two bracketed ids, and the last is always the innermost —
// the one naming this test, not the group it lives in. Taking the first
// match instead attributes every test in that inner describe to the outer
// id, so a clause row can reconcile green against a test that proves a
// different clause. Global-matching and keeping the last id fixes that;
// two ids at the same nesting depth is left as a possible follow-up.
function lastIdIn(title: string): string | undefined {
  let last: string | undefined;
  for (const match of title.matchAll(ID_IN_TITLE)) {
    last = match[1];
  }
  return last;
}

export async function readSuite(reportPath: string): Promise<TestResult[]> {
  const report: unknown = JSON.parse(await readFile(reportPath, 'utf8'));
  const files = (report as { testResults?: unknown[] }).testResults ?? [];
  const results: TestResult[] = [];

  for (const file of files as { assertionResults?: unknown[] }[]) {
    for (const a of (file.assertionResults ?? []) as {
      fullName?: string;
      status?: string;
    }[]) {
      const title = a.fullName ?? '';
      const id = lastIdIn(title);
      if (id === undefined) continue;
      results.push({ id, title, passed: a.status === 'passed' });
    }
  }

  return results;
}
