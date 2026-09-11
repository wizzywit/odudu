export type Status =
  | { kind: 'covered' }
  | { kind: 'deferred'; phase: string; reason: string }
  | { kind: 'na'; reason: string }
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

  throw new Error(`${where}: unrecognised status ${JSON.stringify(raw)}`);
}

export function parseRows(file: string, markdown: string): Row[] {
  const rows: Row[] = [];

  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;

    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());
    if (cells.length !== 5) continue;
    if (!LEVELS.has(cell(cells, 1))) continue;

    const clause = cell(cells, 0);
    const level = cell(cells, 1);
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
