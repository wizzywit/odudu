import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renameSegments } from '#/rename';

const MAPPING = { view: 'ui', usecase: 'use-cases', service: 'services' };
const ALIAS = '#/';

let root = '';

function put(path: string, content: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function run(): ReturnType<typeof renameSegments> {
  execFileSync('git', ['add', '-A'], { cwd: root });
  return renameSegments(root, ALIAS, MAPPING);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'segment-rename-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  put('src/features/a/view/B/B.tsx', 'export const B = 1;\n');
  put('src/features/a/service/rule.ts', 'export const rule = 1;\n');
  put('src/features/a/service/index.ts', 'export {};\n');
  put('src/shared/viewport/x.ts', 'export const x = 1;\n');
  put('src/shared/service.ts', 'export const s = 1;\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('renameSegments', () => {
  it.each([
    ['static import', `import { B } from '#/features/a/view/B/B';\n`],
    ['import type', `import type { B } from '#/features/a/view/B/B';\n`],
    ['export from', `export { B } from '#/features/a/view/B/B';\n`],
    ['dynamic import', `const m = import('#/features/a/view/B/B');\n`],
    ['vi.mock', `vi.mock('#/features/a/view/B/B');\n`],
    ['vi.importActual', `const m = await vi.importActual('#/features/a/view/B/B');\n`],
    ['vi.doMock', `vi.doMock('#/features/a/view/B/B');\n`],
    ['require', `const m = require('#/features/a/view/B/B');\n`],
    ['import type node', `type T = import('#/features/a/view/B/B').B;\n`],
  ])('rewrites %s', (_name, source) => {
    put('src/use.ts', source);
    const result = run();
    expect(read('src/use.ts')).toBe(source.replace('/view/', '/ui/'));
    expect(existsSync(join(root, 'src/features/a/ui/B/B.tsx'))).toBe(true);
    expect(existsSync(join(root, 'src/features/a/view'))).toBe(false);
    expect(result.rewritten).toContain(join(root, 'src/use.ts'));
  });

  it('rewrites a specifier that ends at the directory', () => {
    put('src/use.ts', `import { rule } from '#/features/a/service';\n`);
    run();
    expect(read('src/use.ts')).toBe(`import { rule } from '#/features/a/services';\n`);
  });

  it('leaves a segment that merely resembles a name, and a file named like one', () => {
    const source = `import { x } from '#/shared/viewport/x';\nimport { s } from '#/shared/service';\n`;
    put('src/use.ts', source);
    const result = run();
    expect(read('src/use.ts')).toBe(source);
    expect(result.rewritten).not.toContain(join(root, 'src/use.ts'));
    expect(existsSync(join(root, 'src/shared/service.ts'))).toBe(true);
    expect(existsSync(join(root, 'src/shared/viewport/x.ts'))).toBe(true);
  });

  it('renames a directory at every depth', () => {
    put('src/features/a/view/inner/service/deep.ts', 'export const d = 1;\n');
    put('src/use.ts', `import { d } from '#/features/a/view/inner/service/deep';\n`);
    run();
    expect(existsSync(join(root, 'src/features/a/ui/inner/services/deep.ts'))).toBe(true);
    expect(existsSync(join(root, 'src/features/a/services/rule.ts'))).toBe(true);
    expect(read('src/use.ts')).toBe(`import { d } from '#/features/a/ui/inner/services/deep';\n`);
  });

  it('renames usecase to use-cases', () => {
    put('src/features/a/usecase/useA.ts', 'export const useA = 1;\n');
    put('src/use.ts', `import { useA } from '#/features/a/usecase/useA';\n`);
    run();
    expect(read('src/use.ts')).toBe(`import { useA } from '#/features/a/use-cases/useA';\n`);
  });

  it('keeps a relative specifier resolving after both ends move', () => {
    put(
      'src/features/a/view/R.ts',
      `import { rule } from '../service/rule';\nexport const r = rule;\n`,
    );
    run();
    expect(read('src/features/a/ui/R.ts')).toContain(`from '../services/rule'`);
  });

  it('changes nothing in a dry run', () => {
    put('src/use.ts', `import { B } from '#/features/a/view/B/B';\n`);
    execFileSync('git', ['add', '-A'], { cwd: root });
    const result = renameSegments(root, ALIAS, MAPPING, { dry: true });
    expect(result.moved.length).toBeGreaterThan(0);
    expect(result.rewritten.length).toBeGreaterThan(0);
    expect(read('src/use.ts')).toContain('/view/');
    expect(existsSync(join(root, 'src/features/a/view'))).toBe(true);
  });

  it('leaves a relative specifier from outside src, and one into a non-src directory', () => {
    put('server/service/s.ts', 'export const s = 1;\n');
    put('scripts/run.ts', `import { s } from '../server/service/s';\n`);
    put('src/use.ts', `import { s } from '../server/service/s';\n`);
    const result = run();
    expect(read('scripts/run.ts')).toBe(`import { s } from '../server/service/s';\n`);
    expect(read('src/use.ts')).toBe(`import { s } from '../server/service/s';\n`);
    expect(existsSync(join(root, 'server/service/s.ts'))).toBe(true);
    expect(result.rewritten).not.toContain(join(root, 'scripts/run.ts'));
  });

  it('leaves a bare package specifier and an unrelated relative path alone', () => {
    const source = `import ts from 'typescript';\nimport { x } from './viewport/x';\n`;
    put('src/shared/use.ts', source);
    run();
    expect(read('src/shared/use.ts')).toBe(source);
  });

  it('still rewrites a path under src from a file outside it', () => {
    put('scripts/run.ts', `import { B } from '../src/features/a/view/B/B';\n`);
    run();
    expect(read('scripts/run.ts')).toBe(`import { B } from '../src/features/a/ui/B/B';\n`);
  });
});
