import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ARCHITECTURE_SCAN_TIMEOUT, checkRule } from './rule.ts';
import { SHARED_VOCABULARY } from './shared-vocabulary.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const FIXTURE_ROOT = path.join(import.meta.dirname, '../fixtures/architecture/no-domain-in-shared');
const SHARED_GLOBS = [
  'apps/admin-console/src/shared/**/*.{ts,tsx}',
  'apps/docs/src/shared/**/*.{ts,tsx}',
];
const ALLOWED_SEGMENTS = new Set(['ui', 'api', 'lib', 'config']);
const DOMAIN_WORDS = new Set([
  'tenant',
  'client',
  'subject',
  'role',
  'group',
  'scope',
  'audit',
  'session',
  'administrator',
  'branding',
  'signing',
  'registration',
]);

function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
    .map((word) => (word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word));
}

function hasDomainWord(text: string): boolean {
  return words(text).some((word) => DOMAIN_WORDS.has(word));
}

function exportedNames(source: ts.SourceFile): string[] {
  const names: string[] = [];
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        names.push(...statement.exportClause.elements.map((element) => element.name.text));
      }
      continue;
    }
    const exported = ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      : false;
    if (!exported) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      names.push(statement.name.text);
    }
  }
  return names;
}

interface SharedFile {
  file: string;
  foreignSegment: boolean;
  domainWord: boolean;
}

async function scanShared(root: string): Promise<SharedFile[]> {
  const scanned: SharedFile[] = [];
  for (const pattern of SHARED_GLOBS) {
    for await (const entry of glob(pattern, { cwd: root })) {
      const file = entry.split(path.sep).join('/');
      const afterShared = file.split('/shared/')[1] ?? '';
      const segment = afterShared.split('/')[0] ?? '';
      const text = await readFile(path.join(root, file), 'utf8');
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
      scanned.push({
        file,
        foreignSegment: !ALLOWED_SEGMENTS.has(segment),
        domainWord: hasDomainWord(afterShared) || exportedNames(source).some(hasDomainWord),
      });
    }
  }
  return scanned.sort((a, b) => a.file.localeCompare(b.file));
}

// A file on the vocabulary list is excused its domain word and nothing else.
export async function findSharedBreaches(
  root: string,
  vocabulary: readonly string[] = Object.keys(SHARED_VOCABULARY),
): Promise<string[]> {
  const excused = new Set(vocabulary);
  return (await scanShared(root))
    .filter(({ file, foreignSegment, domainWord }) => {
      return foreignSegment || (domainWord && !excused.has(file));
    })
    .map(({ file }) => file);
}

export async function vocabularyErrors(
  root: string,
  vocabulary: readonly string[] = Object.keys(SHARED_VOCABULARY),
): Promise<string[]> {
  const scanned = new Map((await scanShared(root)).map((entry) => [entry.file, entry]));
  return vocabulary.flatMap((file) => {
    const entry = scanned.get(file);
    if (entry === undefined) return [`${file} is on the shared vocabulary list and does not exist`];
    return entry.domainWord
      ? []
      : [`${file} names no domain word; remove it from the shared vocabulary list`];
  });
}

describe('no-domain-in-shared', () => {
  it('flags a domain word in a path, a domain word in an export and a foreign segment', async () => {
    const base = 'apps/admin-console/src/shared';
    expect(await findSharedBreaches(FIXTURE_ROOT, [])).toEqual([
      `${base}/lib/format.ts`,
      `${base}/lib/platform.ts`,
      `${base}/services/helper.ts`,
      `${base}/ui/TenantPicker.ts`,
    ]);
  });

  it('excuses a listed file its domain word and leaves its segment checked', async () => {
    const base = 'apps/admin-console/src/shared';
    const listed = [
      `${base}/lib/platform.ts`,
      `${base}/ui/TenantPicker.ts`,
      `${base}/services/helper.ts`,
    ];
    expect(await findSharedBreaches(FIXTURE_ROOT, listed)).toEqual([
      `${base}/lib/format.ts`,
      `${base}/services/helper.ts`,
    ]);
  });

  it('fails a listed file that is gone or names no domain word', async () => {
    const base = 'apps/admin-console/src/shared';
    expect(
      await vocabularyErrors(FIXTURE_ROOT, [
        `${base}/lib/platform.ts`,
        `${base}/ui/Button.ts`,
        `${base}/lib/gone.ts`,
      ]),
    ).toEqual([
      `${base}/ui/Button.ts names no domain word; remove it from the shared vocabulary list`,
      `${base}/lib/gone.ts is on the shared vocabulary list and does not exist`,
    ]);
  });

  it(
    'lists only files that exist and still name a domain word',
    async () => {
      expect(await vocabularyErrors(REPO_ROOT)).toEqual([]);
    },
    ARCHITECTURE_SCAN_TIMEOUT,
  );

  it('matches whole words only', () => {
    expect(hasDomainWord('Controller')).toBe(false);
    expect(hasDomainWord('Rolodex')).toBe(false);
    expect(hasDomainWord('roles')).toBe(true);
    expect(hasDomainWord('useTenantsQuery')).toBe(true);
  });

  it(
    'has no breach',
    async () => {
      const found = await findSharedBreaches(REPO_ROOT);
      expect(checkRule('no-domain-in-shared', found).errors).toEqual([]);
    },
    ARCHITECTURE_SCAN_TIMEOUT,
  );
});
