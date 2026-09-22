import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../docs/markdown.js';

interface Hit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

// `git grep` exits 1 on no match, which is this check's success case.
function grepForRealm(): string[] {
  try {
    return execFileSync(
      'git',
      ['grep', '-niI', '-e', 'realm', '--', '.', ':(exclude)node_modules'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
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

// A migration's filename is frozen once `meta/_journal.json` records its
// stem, so every citation of one spells it as the file is named.
function migrationNameCitation(): RegExp {
  const stems = readdirSync(path.join(REPO_ROOT, 'packages/db/drizzle'))
    .filter((name) => name.endsWith('.sql') && name.toLowerCase().includes('realm'))
    .map((name) => name.replace(/\.sql$/u, ''));
  if (stems.length === 0) throw new Error('no migration filename names a realm any more');
  const alternatives = stems.flatMap((stem) => [stem, stem.replace(/^\d+_/u, '')]);
  return new RegExp(alternatives.join('|'), 'u');
}

const MIGRATION_NAME = migrationNameCitation();

const paragraphs = new Map<string, string[]>();

// Keycloak's own concept really is called a realm, and the passages that
// compare the two products name it in the paragraph they argue from.
function comparesWithKeycloak(hit: Hit): boolean {
  let cached = paragraphs.get(hit.file);
  if (cached === undefined) {
    const lines = readFileSync(path.join(REPO_ROOT, hit.file), 'utf8').split('\n');
    const bounds: string[] = [];
    let start = 0;
    for (let i = 0; i <= lines.length; i += 1) {
      if (i < lines.length && lines[i]?.trim() !== '') continue;
      const text = lines.slice(start, i).join('\n');
      for (let j = start; j < i; j += 1) bounds[j] = text;
      start = i + 1;
    }
    cached = bounds;
    paragraphs.set(hit.file, cached);
  }
  return /keycloak/iu.test(cached[hit.line - 1] ?? '');
}

const ALLOWED: readonly ((hit: Hit) => boolean)[] = [
  // The 58 migrations are replayed in order on a fresh database, so they
  // create `realms` before 0057 renames it; `meta/` records them by name.
  (hit) => hit.file.startsWith('packages/db/drizzle/'),
  (hit) => MIGRATION_NAME.test(hit.text),

  // The account of the rename itself, which rewriting would destroy.
  (hit) =>
    [
      'docs/superpowers/specs/2026-09-22-realm-to-tenant-rename-design.md',
      'docs/superpowers/plans/2026-09-22-realm-to-tenant-rename.md',
      'docs/superpowers/rename-spike-postgres.md',
    ].includes(hit.file),
  // One line per ADR written before the rename, saying its decision stands.
  (hit) => hit.file.startsWith('docs/adr/') && hit.text.includes('**Renamed 2026-09-22:**'),

  // Dated records of OIDF runs, paired with log exports the suite signs:
  // a rewritten summary would claim a path that did not yet exist.
  (hit) => hit.file.startsWith('infra/conformance/results/'),
  (hit) => hit.file === 'infra/conformance/README.md',
  // Spike logs quote SQL and test code run against the schema of their day.
  (hit) => /^docs\/superpowers\/[^/]*spike[^/]*\.md$/u.test(hit.file),

  // RFC 7235 §4.1's auth-param names an HTTP protection space, not a tenant:
  // the server emits it, and the documents that read the RFCs name it.
  (hit) => hit.text.includes('realm="'),
  (hit) => hit.text.includes('`realm`'),

  comparesWithKeycloak,
  // Keycloak's role claim, named in the documents that say Odudu emits
  // `roles` and `groups` instead.
  (hit) => hit.text.includes('realm_access'),

  // This test seeds the schema as of migration 39, before 0057 existed, so
  // it writes the columns and the GUC by the names that migration knows.
  (hit) => hit.file === 'packages/authn-flows/tests/migrate-backfill.int.test.ts',
];

describe('the rename left no realm behind', () => {
  it('finds the word only where it is deliberate', () => {
    const found = grepForRealm()
      .map(parse)
      .filter((hit) => !ALLOWED.some((allows) => allows(hit)))
      .map((hit) => `${hit.file}:${String(hit.line)}:${hit.text}`);

    expect(found, `these still say realm:\n${found.join('\n')}`).toEqual([]);
  });
});
