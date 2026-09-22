import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../docs/markdown.js';

// Spelled in pieces because `git grep` searches tracked files and this is
// one: writing it out would make this file its own only finding.
const WORD = ['re', 'alm'].join('');

interface Hit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

// `git grep` exits 1 on no match, which is this check's success case.
function grepForTheOldName(): string[] {
  try {
    return execFileSync('git', ['grep', '-niI', '-e', WORD, '--', '.', ':(exclude)node_modules'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((line) => line.length > 0);
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 1) return [];
    throw error;
  }
}

function parse(line: string): Hit {
  const match = /^(?<file>[^:]+):(?<line>\d+):(?<text>.*)$/su.exec(line);
  const file = match?.groups?.file;
  const number = match?.groups?.line;
  if (file === undefined || number === undefined) {
    throw new Error(`cannot read a path and line out of ${JSON.stringify(line)}`);
  }
  return { file, line: Number(number), text: match?.groups?.text ?? '' };
}

// Whole files that are records of something already done, which rewriting
// would falsify.
const RECORDS: readonly string[] = [
  // Replayed in order on a fresh database, so they create the old table
  // before 0057 renames it; `meta/` records each one by its filename.
  'packages/db/drizzle/',
  // The account of this rename: its design, its plan and its spike.
  `docs/superpowers/specs/2026-09-22-${WORD}-to-tenant-rename-design.md`,
  `docs/superpowers/plans/2026-09-22-${WORD}-to-tenant-rename.md`,
  'docs/superpowers/rename-spike-postgres.md',
  // Dated OIDF runs, paired with log exports the suite signs; the README
  // quotes the same runs' output.
  'infra/conformance/results/',
  'infra/conformance/README.md',
  // Spikes quoting the SQL, test source and stdout of the schema of their day.
  'docs/superpowers/p2a-spike-log.md',
  'docs/superpowers/p2b-spike-log.md',
  // Seeds the schema as of migration 39, before 0057 existed, so it writes
  // the columns and the GUC by the names that migration knows.
  'packages/authn-flows/tests/migrate-backfill.int.test.ts',
];

// A migration's filename is frozen once `meta/_journal.json` records its
// stem, so every citation of one spells it as the file is named — with the
// numeric prefix or, in prose, without it.
function migrationNames(): RegExp {
  const stems = readdirSync(path.join(REPO_ROOT, 'packages/db/drizzle'))
    .filter((name) => name.endsWith('.sql') && name.toLowerCase().includes(WORD))
    .map((name) => name.replace(/\.sql$/u, ''));
  if (stems.length === 0) throw new Error('no migration filename carries the old name any more');
  return new RegExp(
    stems
      .flatMap((stem) => [stem, stem.replace(/^\d+_/u, '')])
      .sort((a, b) => b.length - a.length)
      .join('|'),
    'giu',
  );
}

// Each pattern is one occurrence that is allowed to stand. They are cut out
// of the line, and the question is asked again of what is left, so a
// legitimate token never vouches for the rest of the line it sits on.
const ALLOWED_OCCURRENCES: readonly RegExp[] = [
  migrationNames(),
  // RFC 7235 §4.1's auth-param, which names an HTTP protection space and
  // not a tenant. The lookbehind keeps `data-`-style prefixes out.
  new RegExp(`(?<![\\w-])${WORD}="`, 'giu'),
  // The same auth-param named as a token rather than emitted: no identifier
  // in this project is spelled this way any more.
  new RegExp('`' + WORD + '`', 'giu'),
  // Keycloak's role claim, named where a document says what Odudu emits
  // instead.
  new RegExp(`${WORD}_access`, 'giu'),
  // The one line each ADR written before the rename carries.
  new RegExp(
    `\\*\\*Renamed 2026-09-22:\\*\\* written when a tenant was called a ${WORD}; ` +
      `the decision is unchanged\\.`,
    'gu',
  ),
];

function survivesTheAllowedOccurrences(text: string): boolean {
  let rest = text;
  for (const occurrence of ALLOWED_OCCURRENCES) rest = rest.replace(occurrence, '');
  return new RegExp(WORD, 'iu').test(rest);
}

const UNITS = new Map<string, (string | undefined)[]>();

// The prose unit a line belongs to: a run of non-blank lines, broken by a
// list marker, table row, heading or quote, since each of those is its own
// claim. A line inside a fence belongs to no unit — quoted output argues
// for nothing.
function unitsOf(file: string): (string | undefined)[] {
  const cached = UNITS.get(file);
  if (cached !== undefined) return cached;

  const lines = readFileSync(path.join(REPO_ROOT, file), 'utf8').split('\n');
  const units: (string | undefined)[] = [];
  let start: number | null = null;
  let fenced = false;

  const close = (end: number): void => {
    if (start === null) return;
    const text = lines.slice(start, end).join('\n');
    for (let i = start; i < end; i += 1) units[i] = text;
    start = null;
  };

  lines.forEach((line, index) => {
    if (/^\s*```/u.test(line)) {
      close(index);
      fenced = !fenced;
      return;
    }
    if (fenced || line.trim() === '') {
      close(index);
      return;
    }
    if (/^\s*(?:[-*+]\s|\d+\.\s|\||#{1,6}\s|>)/u.test(line)) close(index);
    start ??= index;
  });
  close(lines.length);

  UNITS.set(file, units);
  return units;
}

// Keycloak's own concept really is called this, and a passage comparing the
// two products names it in the unit it argues from.
function comparesWithKeycloak(hit: Hit): boolean {
  if (!hit.file.startsWith('docs/') || !hit.file.endsWith('.md')) return false;
  return /keycloak/iu.test(unitsOf(hit.file)[hit.line - 1] ?? '');
}

describe('the rename left nothing of the old name behind', () => {
  it('finds the word only where it is deliberate', () => {
    const found = grepForTheOldName()
      .map(parse)
      .filter((hit) => !RECORDS.some((record) => hit.file.startsWith(record)))
      .filter((hit) => !comparesWithKeycloak(hit))
      .filter((hit) => survivesTheAllowedOccurrences(hit.text))
      .map((hit) => `${hit.file}:${String(hit.line)}:${hit.text}`);

    expect(found, `these still carry the old name:\n${found.join('\n')}`).toEqual([]);
  });
});
