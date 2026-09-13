import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseRows, readingNoteHeadings, type Row } from '#/parse';
import { reconcile, type SilencedMusts } from '#/reconcile';
import { readSuite } from '#/suite';

const PROTOCOLS = 'docs/protocols';
const CENSUS = 'tools/trace/silenced-musts.json';

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

// The recorded tally of MUST rows each clause table silences with
// `deferred:` or `n/a:`. Read through `unknown` rather than asserted: the
// file is the thing a rising count has to be written into, so a typo in it
// must fail here rather than quietly reset a table's allowance to zero.
async function loadCensus(): Promise<Map<string, SilencedMusts>> {
  const parsed: unknown = JSON.parse(await readFile(CENSUS, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${CENSUS}: expected an object of file to counts`);
  }
  const census = new Map<string, SilencedMusts>();
  for (const [file, counts] of Object.entries<unknown>(parsed as Record<string, unknown>)) {
    if (typeof counts !== 'object' || counts === null) {
      throw new Error(`${CENSUS}: ${file} does not name a pair of counts`);
    }
    const { deferred, na }: Record<string, unknown> = counts as Record<string, unknown>;
    if (!isCount(deferred) || !isCount(na)) {
      throw new Error(`${CENSUS}: ${file} needs whole-number "deferred" and "na" counts`);
    }
    census.set(file, { deferred, na });
  }
  return census;
}

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
const findings = reconcile(rows, results, { strict, headings, silenced: await loadCensus() });

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
