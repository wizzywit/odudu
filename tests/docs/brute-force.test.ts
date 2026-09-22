import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDocument, REPO_ROOT } from './markdown.js';

// Both documents name the lockout's four defaults as numbers a reader will
// configure against, and a default is the easiest thing in either file to
// change underneath the prose: it lives in one migration and one column
// declaration, neither of which is where anybody would think to look.
const DOCUMENTS = ['README.md', 'docs/request-paths.md'] as const;

const COLUMNS = [
  'brute_force_max_failures',
  'brute_force_lockout_seconds',
  'brute_force_max_lockout_seconds',
  'brute_force_failure_reset_seconds',
] as const;

// The migration is the schema's source of truth (packages/db/README.md), and
// schema-drift.int.test.ts is what ties the TypeScript view to it.
const MIGRATION = 'packages/db/drizzle/0041_login_failures.sql';

function declaredDefaults(): Map<string, string> {
  const sql = readFileSync(path.join(REPO_ROOT, MIGRATION), 'utf8');
  const defaults = new Map<string, string>();
  for (const name of COLUMNS) {
    const stated = new RegExp(
      `ADD COLUMN ${name} integer NOT NULL DEFAULT (?<value>[0-9]+)`,
      'u',
    ).exec(sql);
    if (stated?.groups?.value === undefined) {
      throw new Error(`${MIGRATION} no longer gives ${name} a numeric default`);
    }
    defaults.set(name, stated.groups.value);
  }
  return defaults;
}

// `brute_force_max_failures` (default `5`), and the psql transcript's own
// header-and-values pair. Only the backticked form is read: the prose also
// says "five", which is a sentence rather than a value.
function documentedDefaults(name: string): { column: string; value: string; line: number }[] {
  const lines = loadDocument(name).lines;
  const found: { column: string; value: string; line: number }[] = [];
  for (const column of COLUMNS) {
    // Across the whole file rather than line by line: prose wraps, so a
    // column and the default beside it routinely sit on two lines.
    const stated = new RegExp(`\`${column}\`[^\`]*\\(default \`(?<value>[0-9]+)\`\\)`, 'su').exec(
      lines.join('\n'),
    );
    if (stated?.groups?.value === undefined) continue;
    found.push({
      column,
      value: stated.groups.value,
      line: lines.findIndex((line) => line.includes(column)) + 1,
    });
  }
  return found;
}

describe('the brute-force defaults the documents state are the defaults the schema declares', () => {
  it.each(DOCUMENTS)('%s states no default the tenants table does not', (name) => {
    const declared = declaredDefaults();
    const stated = documentedDefaults(name);

    // README.md names all four; docs/request-paths.md shows them as a
    // transcript instead, so a floor of one is what keeps this check from
    // passing on nothing found.
    if (name === 'README.md' && stated.length !== COLUMNS.length) {
      throw new Error(
        `README.md no longer states all four brute-force defaults (found ${String(stated.length)})`,
      );
    }

    for (const { column, value, line } of stated) {
      expect(
        value,
        `${name}:${String(line)} states a default for ${column} that the migration does not give it`,
      ).toBe(declared.get(column));
    }
  });

  it('shows the same four values in the psql transcript', () => {
    const declared = declaredDefaults();
    const lines = loadDocument('docs/request-paths.md').lines;
    const header = lines.findIndex((line) => line.includes(' brute_force_max_failures | '));
    const values = lines[header + 2]?.trim().split(/\s*\|\s*/u) ?? [];
    if (header === -1 || values.length !== COLUMNS.length) {
      throw new Error(
        'docs/request-paths.md no longer shows the brute-force columns as a psql table',
      );
    }
    expect(values).toEqual(COLUMNS.map((column) => declared.get(column)));
  });
});
