import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// `#/*` is declared twice: package.json `imports` serves Node, Vite and
// dependency-cruiser, and tsconfig `paths` serves tsc, which does not look for
// a folder's index.ts through `imports`. A folder import resolves only while
// the two name the same directory.

const CONSOLE = path.resolve(import.meta.dirname, '../../apps/admin-console');

async function json(file: string): Promise<unknown> {
  const text = await readFile(path.join(CONSOLE, file), 'utf8');
  return JSON.parse(text.replace(/^\s*\/\/.*$/gmu, '')) as unknown;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error('expected an object');
  return Object.fromEntries(Object.entries(value));
}

describe("the console's #/* alias", () => {
  it('names the same directory in package.json and in tsconfig', async () => {
    const imports = record(record(await json('package.json'))['imports']);
    const options = record(record(await json('tsconfig.json'))['compilerOptions']);
    const paths = record(options['paths']);
    expect(imports['#/*']).toBe('./src/*');
    expect(paths['#/*']).toEqual([imports['#/*']]);
  });
});
