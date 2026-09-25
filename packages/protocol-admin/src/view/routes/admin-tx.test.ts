import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const VIEW_DIR = join(import.meta.dirname, '..');

async function sourcesUnder(dir: string): Promise<{ path: string; text: string }[]> {
  const found: { path: string; text: string }[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await sourcesUnder(path)));
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
    found.push({ path, text: await readFile(path, 'utf8') });
  }
  return found;
}

// Reads only the named-import list of an `@odudu/db` import, so a file that
// merely mentions the word `withTenant` in a comment or a string is not an
// offender — only one that actually imports the binding is.
function importsWithTenant(text: string): boolean {
  for (const match of text.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*['"]@odudu\/db['"]/gu)) {
    const specifiers = (match[1] ?? '').split(',').map((s) => s.trim().replace(/^type\s+/u, ''));
    if (specifiers.some((s) => s.split(/\s+as\s+/u)[0] === 'withTenant')) return true;
  }
  return false;
}

describe('importsWithTenant', () => {
  it('flags a file that imports withTenant from @odudu/db', () => {
    expect(importsWithTenant("import { withTenant } from '@odudu/db';")).toBe(true);
    expect(
      importsWithTenant("import {\n  isUniqueViolation,\n  withTenant,\n} from '@odudu/db';"),
    ).toBe(true);
  });

  it('does not flag a file that imports something else from @odudu/db', () => {
    expect(importsWithTenant("import { type Database } from '@odudu/db';")).toBe(false);
    expect(importsWithTenant('// withTenant is mentioned here, not imported')).toBe(false);
  });
});

describe('the view layer never imports withTenant except through adminTx', () => {
  it('is the one place under src/view/ that imports withTenant from @odudu/db', async () => {
    const offenders = (await sourcesUnder(VIEW_DIR))
      .filter((f) => !f.path.endsWith('/routes/admin-tx.ts'))
      .filter((f) => importsWithTenant(f.text))
      .map((f) => f.path.slice(VIEW_DIR.length + 1));

    expect(offenders, 'a file under src/view/ imports withTenant instead of adminTx').toEqual([]);
  });
});
