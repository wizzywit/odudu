import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Modules only some pages need must arrive with those pages' chunks, never
// with the entry every page loads first: libphonenumber-js's metadata (some
// 80 kB), and react-aria's Table, ComboBox and DateInput. A marker is a
// string the module's own code carries and no other code in the console has.

const ASSETS = path.resolve(import.meta.dirname, '../../apps/admin-console/dist/assets');
const FEATURE_ONLY = [
  { what: "libphonenumber-js's metadata", marker: 'country_calling_codes' },
  { what: "react-aria's Table", marker: 'react-aria-Table' },
  { what: "react-aria's ComboBox", marker: 'react-aria-ComboBox' },
  { what: "react-aria's DateInput", marker: 'react-aria-DateInput' },
] as const;

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

describe("the console's feature-only modules", () => {
  const all = chunks();
  const first = loadedFirst(all).map((c) => c.name);

  it('load first with no page', () => {
    expect(first.length).toBeGreaterThan(0);
  });

  for (const { what, marker } of FEATURE_ONLY) {
    it(`bring ${what} with a page that needs it, not with the entry`, () => {
      const holding = all.filter((chunk) => chunk.text.includes(marker)).map((c) => c.name);
      expect(holding.length).toBeGreaterThan(0);
      expect(holding.filter((name) => first.includes(name))).toEqual([]);
    });
  }

  it('counts a statically imported chunk as loaded first, and an import() as not', () => {
    const chunked: Chunk[] = [
      {
        name: 'index-a.js',
        text: 'import{x}from"./shared-b.js";const p=()=>import("./page-c.js");',
      },
      { name: 'shared-b.js', text: 'export const x=1;' },
      { name: 'page-c.js', text: `const m={${FEATURE_ONLY[1].marker}:{}};` },
    ];
    expect(loadedFirst(chunked).map((c) => c.name)).toEqual(['index-a.js', 'shared-b.js']);
  });

  it('sees a marker that a statically imported chunk carries', () => {
    const chunked: Chunk[] = [
      { name: 'index-a.js', text: 'import{x}from"./shared-b.js";' },
      { name: 'shared-b.js', text: `export const x="${FEATURE_ONLY[1].marker}";` },
    ];
    const names = loadedFirst(chunked).map((c) => c.name);
    expect(
      chunked.filter((c) => c.text.includes(FEATURE_ONLY[1].marker)).map((c) => c.name),
    ).toEqual(['shared-b.js']);
    expect(names).toContain('shared-b.js');
  });
});
