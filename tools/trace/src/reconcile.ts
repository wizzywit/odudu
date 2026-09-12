import { type Row } from '#/parse';
import { isSpecificationId, type TestResult } from '#/suite';

export interface Finding {
  severity: 'error' | 'warn';
  row?: Row;
  message: string;
}

// A `documented:` row's reference has to quote the heading it points at, so
// that something other than a reader can tell whether the prose is still
// there. A reference naming no heading of its own file is a broken promise,
// and is an error whether or not strict mode is on — the same treatment a
// `covered` row gets when its test id matches nothing.
const QUOTED = /[\u201c"]([^\u201d"]+)[\u201d"]/gu;

function documentedFinding(
  row: Row,
  reference: string,
  headings: Map<string, Set<string>> | undefined,
  strict: boolean,
): Finding | null {
  const where = `${row.file} \u00a7${row.clause}`;
  const quoted = [...reference.matchAll(QUOTED)].map((m) => m[1]);

  if (quoted.length === 0) {
    return {
      severity: 'error',
      row,
      message: `${where}: documented by prose but the reference quotes no heading (${reference})`,
    };
  }

  if (headings === undefined) return row.level === 'MUST' ? mustFinding(row, where, strict) : null;

  const known = headings.get(row.file) ?? new Set<string>();
  const missing = quoted.filter((title) => title !== undefined && !known.has(title));
  if (missing.length > 0) {
    return {
      severity: 'error',
      row,
      message: `${where}: documented by ${missing.map((t) => JSON.stringify(t)).join(', ')}, which is not a heading in ${row.file}`,
    };
  }

  return row.level === 'MUST' ? mustFinding(row, where, strict) : null;
}

// Prose answers a SHOULD of the shape "the authorization server documents
// its own behaviour". A MUST discharged by prose alone is the shape of the
// defects this table exists to catch, so it is called out either way.
function mustFinding(row: Row, where: string, strict: boolean): Finding {
  return {
    severity: strict ? 'error' : 'warn',
    row,
    message: `${where}: MUST discharged by prose alone`,
  };
}

export function reconcile(
  rows: Row[],
  results: TestResult[],
  options: { strict?: boolean; headings?: Map<string, Set<string>> } = {},
): Finding[] {
  const byId = new Map(results.map((r) => [r.id, r]));
  const findings: Finding[] = [];
  const rowIds = new Set(rows.map((r) => r.testId).filter((id): id is string => id !== null));

  for (const row of rows) {
    const where = `${row.file} §${row.clause}`;

    if (row.status.kind === 'deferred' || row.status.kind === 'na') continue;

    if (row.status.kind === 'documented') {
      const finding = documentedFinding(
        row,
        row.status.reference,
        options.headings,
        options.strict ?? false,
      );
      if (finding !== null) findings.push(finding);
      continue;
    }

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
