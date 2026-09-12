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

// One id is routinely carried by several test results: a
// `describe('[ID] …')` holding several `it`s reports each `it` separately,
// under a `fullName` ending in that same id. Indexing them into one entry
// per id (`new Map(results.map((r) => [r.id, r]))`, as this used to be) kept
// whichever the reporter emitted last, so a red test could be hidden by a
// green sibling and its row still reconcile as covered. Duplication is not
// the error here — losing it is. A row is covered only when every result
// carrying its id passed.
function groupById(results: TestResult[]): Map<string, TestResult[]> {
  const byId = new Map<string, TestResult[]>();
  for (const result of results) {
    const carried = byId.get(result.id);
    if (carried === undefined) byId.set(result.id, [result]);
    else carried.push(result);
  }
  return byId;
}

function failureMessage(where: string, id: string, failed: TestResult[]): string {
  const first = failed[0]?.title ?? id;
  const rest = failed.length - 1;
  return `${where}: ${id} failed: ${first}${rest > 0 ? ` (and ${String(rest)} more carrying that id)` : ''}`;
}

export function reconcile(
  rows: Row[],
  results: TestResult[],
  options: { strict?: boolean; headings?: Map<string, Set<string>> } = {},
): Finding[] {
  const byId = groupById(results);
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

    const carried = row.testId === null ? undefined : byId.get(row.testId);
    if (carried === undefined || carried.length === 0) {
      findings.push({
        severity: 'error',
        row,
        message: `${where}: covered by ${row.testId ?? '?'} but no test carries that id`,
      });
      continue;
    }

    const failed = carried.filter((r) => !r.passed);
    if (failed.length > 0) {
      findings.push({
        severity: 'error',
        row,
        message: failureMessage(where, row.testId ?? '?', failed),
      });
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
