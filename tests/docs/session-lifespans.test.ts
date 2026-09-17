import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDocument, REPO_ROOT } from './markdown.js';

// Both documents now state the two windows a session lives inside, as
// numbers a reader will configure against. Until 2026-09-17 they stated a
// single "12 hours" instead — the fixed constant the lifespans replaced —
// and nothing failed, because a stale sentence and a checked one read
// identically. The defaults live in one migration, which is not where
// anybody looks after rewording a paragraph.
const DOCUMENTS = ['README.md', 'docs/request-paths.md'] as const;

const COLUMNS = ['sso_session_idle_seconds', 'sso_session_max_seconds'] as const;

// The migration is the schema's source of truth (packages/db/README.md), and
// schema-drift.int.test.ts is what ties the TypeScript view to it.
const MIGRATION = 'packages/db/drizzle/0028_realm_session_lifespans.sql';

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

describe('the session lifespans the documents state are the ones the schema declares', () => {
  it.each(DOCUMENTS)('%s states both defaults, and states them right', (name) => {
    const declared = declaredDefaults();
    const text = loadDocument(name).lines.join('\n');

    for (const column of COLUMNS) {
      // Across the whole file rather than line by line: prose wraps, so a
      // column and the default beside it routinely sit on two lines.
      const stated = new RegExp(`\`${column}\`[^\`]*\\(default \`(?<value>[0-9]+)\`\\)`, 'su').exec(
        text,
      );
      if (stated?.groups?.value === undefined) {
        throw new Error(`${name} no longer states a default for ${column}`);
      }
      expect(stated.groups.value).toBe(declared.get(column));
    }
  });

  it('does not still describe the session as the fixed window it replaced', () => {
    for (const name of DOCUMENTS) {
      expect(
        loadDocument(name).lines.join('\n'),
        `${name} still calls the SSO session 12 hours, which is the constant ` +
          `migration ${MIGRATION} replaced with two per-realm windows`,
      ).not.toMatch(/SSO session, 12 hours/u);
    }
  });
});
