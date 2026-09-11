import { readFile } from 'node:fs/promises';

export interface TestResult {
  id: string;
  title: string;
  passed: boolean;
}

const ID_IN_TITLE = /\[([A-Z0-9]+(?:-[A-Za-z0-9.]+)+)\]/u;

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
      const match = ID_IN_TITLE.exec(title);
      const id = match?.[1];
      if (id === undefined) continue;
      results.push({ id, title, passed: a.status === 'passed' });
    }
  }

  return results;
}
