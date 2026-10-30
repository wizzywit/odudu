import { PALETTE_KEYS } from '../../packages/contracts/src/index.js';
import { ASSET_LIMITS, contrastFailures } from '../../packages/domain-theme/src/index.js';
import { PAGE_KINDS } from '../../packages/kernel/src/index.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The console's own modules, loaded by path: its `#/` imports resolve only
// under the console's own configuration, so they are read at run time and
// typed here by what this test uses of them.
const SERVICE = path.resolve(
  import.meta.dirname,
  '../../apps/admin-console/src/features/branding/service',
);
type ServerPalette = NonNullable<Parameters<typeof contrastFailures>[0]['light']>;
type Palette = ServerPalette;
interface Mirrors {
  SLOT_RULES: Record<string, { bytes: number; side: number }>;
  DEFAULT_PALETTES: { light: Palette; dark: Palette };
  MANIFESTS: Record<string, { required: string[]; optional: string[]; inForm: string[] }>;
  pairRows: (scheme: 'light', palette: Palette) => { id: string; passes: boolean }[];
}
async function load(): Promise<Mirrors> {
  const [assets, palette, templates, contrast] = await Promise.all(
    ['assets', 'palette', 'templates', 'contrast'].map(
      (name) => import(path.join(SERVICE, `${name}.ts`)) as Promise<Record<string, unknown>>,
    ),
  );
  return { ...assets, ...palette, ...templates, ...contrast } as unknown as Mirrors;
}

// The Branding screens may not import the server's packages, so three things
// are written out twice: the parts each page kind offers, the contrast pairs
// a palette is held to, and each image kind's limits. Each copy is only a
// preview of the server's verdict; this holds it to the server's own.

describe('what the Branding screens show of the server', () => {
  it('lists the parts of every page kind exactly as the renderer’s manifest does', async () => {
    const { MANIFESTS } = await load();
    expect(Object.keys(MANIFESTS).sort()).toEqual(Object.keys(PAGE_KINDS).sort());
    for (const [kind, manifest] of Object.entries(PAGE_KINDS)) {
      expect(MANIFESTS[kind], kind).toEqual({
        required: manifest.required,
        optional: manifest.optional,
        inForm: manifest.inForm,
      });
    }
  });

  it('states each image kind’s limits as the server enforces them', async () => {
    const { SLOT_RULES } = await load();
    for (const [kind, limits] of Object.entries(ASSET_LIMITS)) {
      const rule = SLOT_RULES[kind];
      expect({ bytes: rule?.bytes, side: rule?.side }, kind).toEqual({
        bytes: limits.maxBytes,
        side: limits.maxSide,
      });
    }
  });

  it('judges a palette by the same pairs as the server, for Instrument’s and for random ones', async () => {
    const { DEFAULT_PALETTES, pairRows } = await load();
    let seed = 7;
    const next = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const colour = (): string =>
      `#${Array.from({ length: 3 }, () =>
        Math.floor(next() * 256)
          .toString(16)
          .padStart(2, '0'),
      ).join('')}`;
    const palettes = [
      DEFAULT_PALETTES.light,
      DEFAULT_PALETTES.dark,
      ...Array.from({ length: 200 }, () =>
        Object.fromEntries(PALETTE_KEYS.map((key) => [key, colour()])),
      ),
    ] as Palette[];
    for (const palette of palettes) {
      const server = contrastFailures({ light: palette })
        .map((failure) => failure.pair)
        .sort();
      const here = pairRows('light', palette)
        .filter((row) => !row.passes)
        .map((row) => row.id.replace('light:', ''))
        .sort();
      expect(here).toEqual(server);
    }
  });

  it('words “more themes than listed” as the server’s detail does', async () => {
    const { IN_USE_MORE } = (await import(path.join(SERVICE, 'assets.ts'))) as {
      IN_USE_MORE: string;
    };
    const server = readFileSync(
      path.resolve(
        import.meta.dirname,
        '../../packages/protocol-admin/src/view/routes/theme-assets.ts',
      ),
      'utf8',
    );
    expect(server).toContain(IN_USE_MORE);
  });

  it('holds Instrument’s own palettes, which customising starts from, to the server’s check', async () => {
    const { DEFAULT_PALETTES } = await load();
    expect(
      contrastFailures({
        light: DEFAULT_PALETTES.light,
        dark: DEFAULT_PALETTES.dark,
      }),
    ).toEqual([]);
  });

  it('words every refusal the server’s stylesheet check can make', () => {
    const codes = (source: string): string[] =>
      [...source.matchAll(/'([a-z-]+)'/gu)].map((match) => match[1] ?? '').sort();
    const server = readFileSync(
      path.resolve(
        import.meta.dirname,
        '../../packages/domain-theme/src/service/stylesheet-types.ts',
      ),
      'utf8',
    );
    const union = /type StylesheetIssueCode =([^;]+);/u.exec(server)?.[1] ?? '';
    const console_ = readFileSync(path.join(SERVICE, 'stylesheet.ts'), 'utf8');
    const table = /STYLESHEET_REFUSALS[^=]*=\s*\{([\s\S]*?)\n\};/u.exec(console_)?.[1] ?? '';
    const keys = [...table.matchAll(/^\s*(?:'([a-z-]+)'|([a-z]+)):/gmu)]
      .map((match) => match[1] ?? match[2] ?? '')
      .sort();
    expect(codes(union).length).toBeGreaterThan(10);
    expect(keys).toEqual(codes(union));
  });
});
