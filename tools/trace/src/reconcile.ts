import { type Row } from '#/parse';
import { isSpecificationId, type TestResult } from '#/suite';

export interface Finding {
  severity: 'error' | 'warn';
  row?: Row;
  message: string;
}

// A `documented:` or `accepted:` row's reference has to quote the heading it
// points at, so that something other than a reader can tell whether the
// prose is still there. A reference naming no heading of its own file is a
// broken promise, and is an error whether or not strict mode is on — the
// same treatment a `covered` row gets when its test id matches nothing.
const QUOTED = /[“"]([^”"]+)[”"]/gu;

// What a row discharged by prose rather than by a passing test is worth.
// `documented:` escalates its MUST under strict, because prose standing in
// for observable behaviour is the defect this table exists to catch.
// `accepted:` does not: the obligation is one this process has decided it
// will never satisfy, so no work here would pay the row off and a build
// that goes red over it can only be quieted by lying about the row. Both
// are reported in both modes, so neither ever goes silent.
interface ProseStatus {
  verb: string;
  mustSeverity: (strict: boolean) => Finding['severity'];
  mustMessage: string;
}

const DOCUMENTED: ProseStatus = {
  verb: 'documented by',
  mustSeverity: (strict) => (strict ? 'error' : 'warn'),
  mustMessage: 'MUST discharged by prose alone',
};

const ACCEPTED: ProseStatus = {
  verb: 'accepted against',
  mustSeverity: () => 'warn',
  mustMessage: 'MUST accepted rather than held by a test here',
};

function proseFinding(
  row: Row,
  reference: string,
  kind: ProseStatus,
  headings: Map<string, Set<string>> | undefined,
  strict: boolean,
): Finding | null {
  const where = `${row.file} §${row.clause}`;
  const quoted = [...reference.matchAll(QUOTED)].map((m) => m[1]);

  const mustFinding = (): Finding | null =>
    row.level === 'MUST'
      ? { severity: kind.mustSeverity(strict), row, message: `${where}: ${kind.mustMessage}` }
      : null;

  if (quoted.length === 0) {
    return {
      severity: 'error',
      row,
      message: `${where}: ${kind.verb} prose but the reference quotes no heading (${reference})`,
    };
  }

  if (headings === undefined) return mustFinding();

  const known = headings.get(row.file) ?? new Set<string>();
  const missing = quoted.filter((title) => title !== undefined && !known.has(title));
  if (missing.length > 0) {
    return {
      severity: 'error',
      row,
      message: `${where}: ${kind.verb} ${missing.map((t) => JSON.stringify(t)).join(', ')}, which is not a heading in ${row.file}`,
    };
  }

  return mustFinding();
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

    if (row.status.kind === 'documented' || row.status.kind === 'accepted') {
      const finding = proseFinding(
        row,
        row.status.reference,
        row.status.kind === 'documented' ? DOCUMENTED : ACCEPTED,
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
