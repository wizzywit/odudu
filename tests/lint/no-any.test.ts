import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// The `any` ban has two halves, and only the first is a lint rule.

// The rules below reject `any` however it arrives: written out, cast to, or
// leaked from an untyped boundary like JSON.parse. That half is enforced by
// typescript-eslint's strictTypeChecked preset; the first block is a
// positive control proving each rule is live, not silently dropped.

// The second half is that an inline `eslint-disable` defeats any lint rule,
// exits zero, and leaves no trace. A ban nobody can re-enable by hand is the
// only kind that survives; the second block is what makes it one.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

const ANY_RULES = [
  '@typescript-eslint/no-explicit-any',
  '@typescript-eslint/no-unsafe-return',
  '@typescript-eslint/no-unsafe-assignment',
  '@typescript-eslint/no-unsafe-member-access',
  '@typescript-eslint/no-unsafe-call',
  '@typescript-eslint/no-unsafe-argument',
] as const;

async function lint(source: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const results = await eslint.lintText(source, { filePath: 'packages/kernel/src/index.ts' });
  const [result] = results;
  if (!result) throw new Error('expected a lint result');
  return result.messages.map((m) => m.ruleId ?? '');
}

describe('the any ban is enforced by lint', { timeout: 60_000 }, () => {
  it('rejects an explicit any annotation', async () => {
    const ruleIds = await lint('export function f(x: any): void {\n  console.log(x);\n}\n');
    expect(ruleIds).toContain('@typescript-eslint/no-explicit-any');
  });

  it('rejects a cast to any', async () => {
    const ruleIds = await lint('export const n: number = "s" as any;\n');
    expect(ruleIds).toContain('@typescript-eslint/no-explicit-any');
  });

  it('rejects any leaking in from an untyped boundary', async () => {
    const ruleIds = await lint(
      'export function f(s: string): unknown {\n  const parsed = JSON.parse(s);\n  return parsed.value;\n}\n',
    );
    expect(ruleIds).toContain('@typescript-eslint/no-unsafe-assignment');
    expect(ruleIds).toContain('@typescript-eslint/no-unsafe-member-access');
  });

  it('accepts unknown, which is the intended replacement', async () => {
    const ruleIds = await lint('export function f(x: unknown): string {\n  return typeof x;\n}\n');
    for (const rule of ANY_RULES) expect(ruleIds).not.toContain(rule);
  });
});

const SOURCE_TREES = [
  'packages/*/src/**/*.{ts,tsx}',
  'packages/*/tests/**/*.{ts,tsx}',
  'apps/*/src/**/*.{ts,tsx}',
  'apps/*/tests/**/*.{ts,tsx}',
  'tools/*/src/**/*.ts',
  'tests/**/*.ts',
];

async function scannedFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const pattern of SOURCE_TREES) {
    for await (const file of glob(pattern, {
      cwd: REPO_ROOT,
      exclude: (entry) => path.basename(entry) === 'node_modules',
    })) {
      files.push(file.split(path.sep).join('/'));
    }
  }
  return files;
}

function waivers(file: string, source: string): string[] {
  const offenders: string[] = [];
  for (const line of source.split('\n')) {
    if (!line.includes('eslint-disable')) continue;
    for (const rule of ANY_RULES) {
      if (line.includes(rule)) offenders.push(`${file}: ${line.trim()}`);
    }
  }
  // A bare `eslint-disable` with no rule list switches off every rule in
  // the file, including these, without ever naming them.
  if (/eslint-disable(-next-line|-line)?\s*(\*\/|$)/m.test(source)) {
    offenders.push(`${file}: blanket eslint-disable`);
  }
  return offenders;
}

describe('the any ban cannot be waived by an inline comment', { timeout: 60_000 }, () => {
  it('no source file disables an any-family rule', async () => {
    const offenders: string[] = [];
    for (const file of await scannedFiles()) {
      offenders.push(...waivers(file, await readFile(path.join(REPO_ROOT, file), 'utf8')));
    }
    expect(offenders).toEqual([]);
  });

  it('reaches every source tree, component files included', async () => {
    const files = await scannedFiles();
    expect(files).toContain('apps/admin-console/src/app/App/App.tsx');
    expect(files).toContain('packages/kernel/src/config.ts');
  });

  it('catches a waiver in a component file', () => {
    const source =
      '// eslint-' +
      'disable-next-line @typescript-eslint/no-explicit-any\n' +
      'export const App = (props: any) => <p>{props}</p>;\n';
    expect(waivers('apps/admin-console/src/app/App/App.tsx', source)).toHaveLength(1);
  });
});
