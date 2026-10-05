import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// A service file holds one topic and stays short enough to read in one sitting:
// 300 lines at most, tests excepted. A longer file is split by topic into
// siblings of the same service folder, never allowed past the limit.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONSOLE_SERVICES = 'apps/admin-console/src/**/service/**/*.ts';
const FIXTURES = 'tests/lint/fixtures/console-service-length';
const LIMIT = 300;

export function lengthOf(source: string): number {
  const lines = source.split('\n').length;
  return source.endsWith('\n') ? lines - 1 : lines;
}

export function violation(file: string, source: string): string | null {
  if (file.endsWith('.test.ts')) return null;
  const length = lengthOf(source);
  return length > LIMIT
    ? `${file} is ${String(length)} lines, over the ${String(LIMIT)} a service file may hold`
    : null;
}

async function read(pattern: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const file of glob(pattern, { cwd: REPO_ROOT })) {
    const posix = file.split(path.sep).join('/');
    files.set(posix, await readFile(path.join(REPO_ROOT, file), 'utf8'));
  }
  return files;
}

describe("the console's service files", { timeout: 60_000 }, () => {
  it('stay within the length limit, tests excepted', async () => {
    const files = await read(CONSOLE_SERVICES);
    expect([...files.keys()]).toContain(
      'apps/admin-console/src/features/subjects/service/index.ts',
    );
    expect([...files.keys()]).toContain('apps/admin-console/src/shared/service/dirty.ts');
    const offenders = [...files].flatMap(([file, source]) => violation(file, source) ?? []);
    expect(offenders).toEqual([]);
  });

  it('pass every conforming fixture, a test file of any length among them', async () => {
    const files = await read(`${FIXTURES}/pass/**/service/**/*.ts`);
    expect(files.size).toBe(3);
    for (const [file, source] of files) expect(violation(file, source), file).toBeNull();
  });

  it('fail every non-conforming fixture, naming the file and its length', async () => {
    const files = await read(`${FIXTURES}/fail/**/service/**/*.ts`);
    expect(files.size).toBe(2);
    for (const [file, source] of files) {
      expect(violation(file, source), file).toBe(
        `${file} is ${String(lengthOf(source))} lines, over the 300 a service file may hold`,
      );
    }
  });
});
