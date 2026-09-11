import { readFile } from 'node:fs/promises';

export interface TestResult {
  id: string;
  title: string;
  passed: boolean;
}

const ID_IN_TITLE = /\[([A-Z0-9]+(?:-[A-Za-z0-9.]+)+)\]/gu;

// `fullName` concatenates every ancestor describe title with the test's own
// title, outermost first. A describe nested inside one that already carries
// an id therefore carries two bracketed ids in the same string — and the
// last one to appear is always the innermost, i.e. the one naming this
// specific test rather than the group it lives in. Taking the first match
// (a single non-global regex, as this used to be) attributes every test in
// that inner describe to the outer id instead, so a clause row can
// reconcile green against a test that actually proves a different clause.
// Global-matching and keeping the last id fixes that; nothing here catches
// the case of two ids at the same nesting depth (e.g. two ids on one `it`
// title), which is ambiguous rather than nested and is left as a possible
// follow-up if it turns out to occur in practice.
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
