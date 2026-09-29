import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// libphonenumber-js's metadata is some 80 kB, and only a page with a phone
// field needs it; it must arrive with that page's chunk, never with the
// entry every page loads first.

const ASSETS = path.resolve(import.meta.dirname, '../../apps/admin-console/dist/assets');
// A key of the metadata's own JSON, which no other code in the console has.
const METADATA = 'country_calling_codes';

interface Chunk {
  readonly name: string;
  readonly text: string;
}

function chunks(): Chunk[] {
  if (!existsSync(ASSETS)) {
    throw new Error(
      'apps/admin-console/dist is missing: run the build first (pnpm verify builds it before testing)',
    );
  }
  return readdirSync(ASSETS)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({ name, text: readFileSync(path.join(ASSETS, name), 'utf8') }));
}

// The chunks the entry loads before anything renders: itself and every
// chunk it imports statically, transitively. A dynamic import() is a
// page's own chunk, loaded only when the page is.
export function loadedFirst(all: readonly Chunk[]): readonly Chunk[] {
  const byName = new Map(all.map((chunk) => [chunk.name, chunk]));
  const entry = all.find((chunk) => chunk.name.startsWith('index-'));
  const seen = new Map<string, Chunk>();
  const visit = (chunk: Chunk | undefined): void => {
    if (chunk === undefined || seen.has(chunk.name)) return;
    seen.set(chunk.name, chunk);
    for (const [, name = ''] of chunk.text.matchAll(
      /(?:^|[;}])\s*import\s*[^(]*?from\s*"\.\/([^"]+)"/gu,
    )) {
      visit(byName.get(name));
    }
  };
  visit(entry);
  return [...seen.values()];
}

describe("the console's phone numbering plans", () => {
  it('arrive with a page that shows a phone field, not with the entry', () => {
    const all = chunks();
    const holding = all.filter((chunk) => chunk.text.includes(METADATA)).map((c) => c.name);
    expect(holding.length).toBeGreaterThan(0);
    const first = loadedFirst(all).map((c) => c.name);
    expect(first.length).toBeGreaterThan(0);
    expect(holding.filter((name) => first.includes(name))).toEqual([]);
  });

  it('counts a statically imported chunk as loaded first, and an import() as not', () => {
    const all: Chunk[] = [
      {
        name: 'index-a.js',
        text: 'import{x}from"./shared-b.js";const p=()=>import("./page-c.js");',
      },
      { name: 'shared-b.js', text: 'export const x=1;' },
      { name: 'page-c.js', text: `const m={${METADATA}:{}};` },
    ];
    expect(loadedFirst(all).map((c) => c.name)).toEqual(['index-a.js', 'shared-b.js']);
  });
});
