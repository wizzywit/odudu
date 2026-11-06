import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A tenant is reached by a path on the shared host or by a host of its own,
// and only the address service knows which. A page, cookie, redirect or issuer
// that spells `/tenants/<name>` itself is right for one and wrong for the
// other, so production code writes tenant addresses through `@odudu/kernel`.

// It reads string and template text, so a comment never counts, and it sees
// only a literal `/tenants/` followed by something other than `:` or `{` (the
// spellings of a route pattern) and a call named `tenantIssuer`. A regex
// literal, a path assembled from pieces or one held in a variable is not seen.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

// The address service itself; the admin and console gateways, which are
// reached by path on the shared host only; the MCP catalogue, its tenant tools
// and its path expansion, which name admin route patterns; the console's CLI client; and the app's route-prefix test,
// which reads a route pattern.
const ALLOWED = [
  'packages/kernel/src/address.ts',
  'packages/protocol-admin/',
  'packages/console-gateway/',
  'packages/mcp/src/service/catalogue.ts',
  'packages/mcp/src/service/admin-path.ts',
  'packages/mcp/src/service/tools/tenants.ts',
  'apps/server/src/cli/console.ts',
  'apps/server/src/app.ts',
];

const TENANT_PATH = /\/tenants\/(?!:|\{)/u;

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly what: string;
}

export function findings(file: string, source: string): Finding[] {
  const found: Finding[] = [];
  if (!source.includes('/tenants/') && !source.includes('tenantIssuer')) return found;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const report = (node: ts.Node, what: string): void => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    found.push({ file, line: line + 1, what });
  };
  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      TENANT_PATH.test(node.text)
    ) {
      report(node, `writes a /tenants/ path by hand`);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'tenantIssuer'
    ) {
      report(node, 'calls tenantIssuer');
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function isProduction(file: string): boolean {
  return (
    !file.endsWith('.test.ts') &&
    !file.split('/').includes('testing') &&
    !ALLOWED.some((entry) => file === entry || (entry.endsWith('/') && file.startsWith(entry)))
  );
}

async function productionFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const pattern of ['packages/*/src/**/*.ts', 'apps/server/src/**/*.ts']) {
    for await (const file of glob(pattern, { cwd: REPO_ROOT })) {
      const normal = file.split(path.sep).join('/');
      if (isProduction(normal)) files.push(normal);
    }
  }
  return files.sort();
}

const READ_BATCH = 32;

describe('tenant addresses are written through the address service', { timeout: 60_000 }, () => {
  it('no production file spells a tenant path or issuer itself', async () => {
    const files = await productionFiles();
    const all: string[] = [];
    for (let i = 0; i < files.length; i += READ_BATCH) {
      const batch = files.slice(i, i + READ_BATCH);
      const sources = await Promise.all(
        batch.map((file) => readFile(path.join(REPO_ROOT, file), 'utf8')),
      );
      batch.forEach((file, index) => {
        for (const f of findings(file, sources[index] ?? '')) {
          all.push(`${f.file}:${String(f.line)} ${f.what}`);
        }
      });
    }
    expect(all).toEqual([]);
  });

  it('sees a hand-built path and a tenantIssuer call, and not a route pattern', () => {
    const source = [
      'const a = `/tenants/${name}/x`;',
      "const b = '/tenants/acme/y';",
      "const c = '/tenants/:tenant/z';",
      "const d = tenantIssuer(base, 'acme');",
      "// '/tenants/in-a-comment'",
    ].join('\n');
    expect(findings('f.ts', source).map((f) => f.line)).toEqual([1, 2, 4]);
  });

  it('still ignores the substring in a comment, and finds a hit among other text', () => {
    expect(findings('f.ts', "// '/tenants/x' and tenantIssuer(a)\nconst a = 1;")).toEqual([]);
    expect(
      findings('f.ts', 'const a = 1;\n\nconst b = `/tenants/${a}`;').map((f) => f.line),
    ).toEqual([3]);
  });
});
