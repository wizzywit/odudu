import { type Row } from '#/parse';
import { isSpecificationId, type TestResult } from '#/suite';

export interface Finding {
  severity: 'error' | 'warn';
  row?: Row;
  message: string;
}

export function reconcile(
  rows: Row[],
  results: TestResult[],
  options: { strict?: boolean } = {},
): Finding[] {
  const byId = new Map(results.map((r) => [r.id, r]));
  const findings: Finding[] = [];
  const rowIds = new Set(rows.map((r) => r.testId).filter((id): id is string => id !== null));

  for (const row of rows) {
    const where = `${row.file} §${row.clause}`;

    if (row.status.kind === 'deferred' || row.status.kind === 'na') continue;

    if (row.status.kind === 'gap') {
      if (row.level !== 'MUST') continue;
      findings.push({
        severity: options.strict ? 'error' : 'warn',
        row,
        message: `${where}: MUST has no test`,
      });
      continue;
    }

    const result = row.testId === null ? undefined : byId.get(row.testId);
    if (!result) {
      findings.push({
        severity: 'error',
        row,
        message: `${where}: covered by ${row.testId ?? '?'} but no test carries that id`,
      });
      continue;
    }

    if (!result.passed) {
      findings.push({ severity: 'error', row, message: `${where}: ${row.testId ?? '?'} failed` });
    }
  }

  for (const result of results) {
    if (!isSpecificationId(result.id)) continue;
    if (rowIds.has(result.id)) continue;
    findings.push({
      severity: 'error',
      message: `${result.id}: test title carries a specification-style id but no docs/protocols row references it (${result.title})`,
    });
  }

  return findings;
}
