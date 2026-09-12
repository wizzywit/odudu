export type Status =
  | { kind: 'covered' }
  | { kind: 'deferred'; phase: string; reason: string }
  | { kind: 'na'; reason: string }
  // The obligation is to say something rather than to do something — "the
  // authorization server documents its scope requirements", and its like.
  // `covered` cannot hold such a row, because there is no behaviour a test
  // could observe, and `n/a` would file a requirement Odudu *meets*
  // alongside the ones addressed to somebody else. The reference names the
  // prose that discharges it, and reconcile checks it resolves.
  | { kind: 'documented'; reference: string }
  // The obligation is in scope, understood, and deliberately not satisfied
  // by this process — TLS on the wire, which Odudu does not terminate, is
  // the whole of the set today. `gap` would say nobody got to it and `n/a`
  // would say it is addressed to somebody else; neither is true, and both
  // lose the only thing worth recording, which is where the obligation *is*
  // met. The reference names the prose that says so, and reconcile checks
  // it resolves. Deliberately carries no phase: a row whose honest answer
  // is "a later phase does this" is `deferred:` (see ADR 0017).
  | { kind: 'accepted'; reference: string }
  | { kind: 'gap' };

export interface Row {
  file: string;
  clause: string;
  level: 'MUST' | 'SHOULD' | 'MAY';
  requirement: string;
  testId: string | null;
  status: Status;
}

const LEVELS = new Set(['MUST', 'SHOULD', 'MAY']);
const CLAUSE_HEADER = ['Clause', 'Level', 'Requirement', 'Test ID', 'Status'];

function isClauseHeader(cells: string[]): boolean {
  return cells.length === CLAUSE_HEADER.length && cells.every((c, i) => c === CLAUSE_HEADER[i]);
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((c) => /^:?-+:?$/u.test(c));
}

function cell(cells: string[], i: number): string {
  const value = cells[i];
  if (value === undefined) throw new Error(`expected cell ${String(i)} to exist`);
  return value;
}

function group(match: RegExpExecArray, i: number): string {
  const value = match[i];
  if (value === undefined) throw new Error(`expected capture group ${String(i)} to exist`);
  return value;
}

function parseStatus(raw: string, where: string): Status {
  if (raw === 'covered') return { kind: 'covered' };
  if (raw === 'gap') return { kind: 'gap' };

  const deferred = /^deferred:\s*(\S+)\s*—\s*(.+)$/u.exec(raw);
  if (deferred) return { kind: 'deferred', phase: group(deferred, 1), reason: group(deferred, 2) };

  const na = /^n\/a:\s*(.+)$/u.exec(raw);
  if (na) return { kind: 'na', reason: group(na, 1) };

  const documented = /^documented:\s*(\S.*)$/u.exec(raw);
  if (documented) return { kind: 'documented', reference: group(documented, 1) };

  const accepted = /^accepted:\s*(\S.*)$/u.exec(raw);
  if (accepted) return { kind: 'accepted', reference: group(accepted, 1) };

  throw new Error(`${where}: unrecognised status ${JSON.stringify(raw)}`);
}

export function parseRows(file: string, markdown: string): Row[] {
  const rows: Row[] = [];
  const lines = markdown.split('\n');
  let inClauseTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = cell(lines, i);
    const trimmed = line.trim();

    if (!trimmed.startsWith('|')) {
      inClauseTable = false;
      continue;
    }

    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());

    if (isClauseHeader(cells)) {
      inClauseTable = true;
      continue;
    }

    if (isSeparatorRow(cells)) continue;
    if (!inClauseTable) continue;

    const lineWhere = `${file}:${String(i + 1)}`;
    if (cells.length !== 5) {
      throw new Error(`${lineWhere}: clause row has ${String(cells.length)} cells, expected 5`);
    }

    const level = cell(cells, 1);
    if (!LEVELS.has(level)) {
      throw new Error(`${lineWhere}: unrecognised level ${JSON.stringify(level)}`);
    }

    const clause = cell(cells, 0);
    const requirement = cell(cells, 2);
    const testCell = cell(cells, 3);
    const statusCell = cell(cells, 4);
    const where = `${file} clause ${clause}`;
    const testId = testCell === '—' ? null : testCell.replace(/`/g, '');
    const status = parseStatus(statusCell, where);

    if (status.kind === 'covered' && testId === null) {
      throw new Error(`${where}: status is covered but no test id is given`);
    }

    rows.push({
      file,
      clause,
      level: level as Row['level'],
      requirement,
      testId,
      status,
    });
  }

  return rows;
}

// Every ATX heading in a protocol document, which is what a `documented:`
// row's reference points at. The leading `|` guard keeps a hash inside a
// clause row's requirement text from reading as one.
const HEADING = /^#{1,6}\s+(\S.*?)\s*$/u;

export function readingNoteHeadings(markdown: string): Set<string> {
  const headings = new Set<string>();
  for (const line of markdown.split('\n')) {
    if (line.startsWith('|')) continue;
    const match = HEADING.exec(line);
    if (match !== null) headings.add(group(match, 1));
  }
  return headings;
}
