import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, expect, it } from 'vitest';

// The responsive modes key on the shell's width, so every stylesheet names
// one container, `shell`. CSS Modules may scope that name, which would
// silently break every query; this runs the real transform to catch it.
const APP = path.resolve(import.meta.dirname, '../../apps/admin-console');
const SHELL_QUERIES = ['AppShell.module.css', 'DataTable.module.css', 'Section.module.css'];

// The slice of Vite's API this uses; the repo checks do not depend on Vite.
interface ViteApi {
  resolveConfig: (
    inline: { root: string; configFile: string },
    command: 'build',
  ) => Promise<unknown>;
  preprocessCSS: (code: string, filename: string, config: unknown) => Promise<{ code: string }>;
}

let vite: ViteApi;
let config: unknown;

// The console's own Vite, resolved from its package, so the transform is the
// one its build runs.
beforeAll(async () => {
  const entry = createRequire(path.join(APP, 'package.json')).resolve('vite');
  vite = (await import(pathToFileURL(entry).href)) as ViteApi;
  config = await vite.resolveConfig(
    { root: APP, configFile: path.join(APP, 'vite.config.ts') },
    'build',
  );
});

async function built(file: string): Promise<string> {
  const filename = path.join(APP, 'src/shared/view', file);
  return (await vite.preprocessCSS(await readFile(filename, 'utf8'), filename, config)).code;
}

it('declares the shell container once, unscoped, in the global stylesheet', async () => {
  expect(await built('global.css')).toMatch(/container:\s*shell\s*\/\s*inline-size/u);
  for (const file of SHELL_QUERIES) {
    expect(await built(file), file).not.toMatch(/container(?:-name)?:\s*[\w-]*shell/u);
  }
});

it('keeps every query on the name shell once the modules are built', async () => {
  for (const file of SHELL_QUERIES) {
    const names = [...(await built(file)).matchAll(/@container\s+([\w-]+)/gu)].map(
      ([, name = '']) => name,
    );
    expect(names.length, file).toBeGreaterThan(0);
    expect(new Set(names), file).toEqual(new Set(['shell']));
  }
});

it('stacks tables and pins save bars under 640, and drops columns under 1024', async () => {
  const table = await built('DataTable.module.css');
  expect(table).toMatch(/@container shell \(width < 640px\)/u);
  expect(table).toMatch(/@container shell \(width < 1024px\)/u);
  expect(await built('Section.module.css')).toMatch(/@container shell \(width < 640px\)/u);
});
