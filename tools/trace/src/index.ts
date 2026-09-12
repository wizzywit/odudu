import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseRows, readingNoteHeadings, type Row } from '#/parse';
import { reconcile } from '#/reconcile';
import { readSuite } from '#/suite';

const PROTOCOLS = 'docs/protocols';

async function loadTables(): Promise<{ rows: Row[]; headings: Map<string, Set<string>> }> {
  const files = (await readdir(PROTOCOLS)).filter((f) => f.endsWith('.md'));
  const rows: Row[] = [];
  const headings = new Map<string, Set<string>>();
  for (const file of files) {
    const markdown = await readFile(join(PROTOCOLS, file), 'utf8');
    rows.push(...parseRows(file, markdown));
    headings.set(file, readingNoteHeadings(markdown));
  }
  return { rows, headings };
}

const strict = process.env.ODUDU_TRACE_STRICT === '1';
const { rows, headings } = await loadTables();
const results = await readSuite(process.argv[2] ?? 'trace-report.json');
const findings = reconcile(rows, results, { strict, headings });

const counts = {
  covered: rows.filter((r) => r.status.kind === 'covered').length,
  gap: rows.filter((r) => r.status.kind === 'gap').length,
  deferred: rows.filter((r) => r.status.kind === 'deferred').length,
  na: rows.filter((r) => r.status.kind === 'na').length,
  documented: rows.filter((r) => r.status.kind === 'documented').length,
  accepted: rows.filter((r) => r.status.kind === 'accepted').length,
};

for (const f of findings) console.error(`${f.severity}: ${f.message}`);
console.log(
  `trace: ${String(counts.covered)} covered, ${String(counts.gap)} gap, ` +
    `${String(counts.deferred)} deferred, ${String(counts.na)} n/a, ` +
    `${String(counts.documented)} documented, ` +
    `${String(counts.accepted)} accepted` +
    (strict ? ' (strict)' : ''),
);

if (findings.some((f) => f.severity === 'error')) process.exit(1);
