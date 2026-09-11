import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseRows, type Row } from '#/parse';
import { reconcile } from '#/reconcile';
import { readSuite } from '#/suite';

const PROTOCOLS = 'docs/protocols';

async function loadRows(): Promise<Row[]> {
  const files = (await readdir(PROTOCOLS)).filter((f) => f.endsWith('.md'));
  const rows: Row[] = [];
  for (const file of files) {
    rows.push(...parseRows(file, await readFile(join(PROTOCOLS, file), 'utf8')));
  }
  return rows;
}

const strict = process.env.ODUDU_TRACE_STRICT === '1';
const rows = await loadRows();
const results = await readSuite(process.argv[2] ?? 'trace-report.json');
const findings = reconcile(rows, results, { strict });

const counts = {
  covered: rows.filter((r) => r.status.kind === 'covered').length,
  gap: rows.filter((r) => r.status.kind === 'gap').length,
  deferred: rows.filter((r) => r.status.kind === 'deferred').length,
  na: rows.filter((r) => r.status.kind === 'na').length,
};

for (const f of findings) console.error(`${f.severity}: ${f.message}`);
console.log(
  `trace: ${String(counts.covered)} covered, ${String(counts.gap)} gap, ` +
    `${String(counts.deferred)} deferred, ${String(counts.na)} n/a` +
    (strict ? ' (strict)' : ''),
);

if (findings.some((f) => f.severity === 'error')) process.exit(1);
