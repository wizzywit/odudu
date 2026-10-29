import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '../../apps/admin-console/src');
const read = (file: string): string => readFileSync(path.join(SRC, file), 'utf8');
const files = (pattern: string): string[] =>
  globSync(pattern, { cwd: SRC }).filter((file) => !file.includes('node_modules'));

// A container query cannot read a custom property, so the one width at which
// the Branding pages narrow is written in each stylesheet that asks, and held
// to `NARROW_REM` here: change one, and this fails until they all agree.
const NARROW_REM = Number(
  /export const NARROW_REM = (\d+);/u.exec(read('shared/service/narrow.ts'))?.[1],
);

// The widths a stylesheet asks about with `<`, in `@container` or `@media`, in
// either spelling of the feature (`inline-size < 48rem`, `width < 48rem`).
export function narrowWidths(css: string): number[] {
  return [
    ...css.matchAll(
      /@(?:container|media)[^{]*?\((?:min-|max-)?(?:inline-size|width)\s*(?:<|:)\s*([\d.]+)rem\)/gu,
    ),
  ].map((match) => Number(match[1]));
}

// The stylesheets, by name, that ask about any other width.
export function offenders(sheets: Readonly<Record<string, string>>): string[] {
  return Object.entries(sheets)
    .filter(([, css]) => narrowWidths(css).some((width) => width !== NARROW_REM))
    .map(([name]) => name);
}

// The stylesheets that sit inside the editor's frame, found and not listed,
// so a new one is held to the same width. The bar measures its own width.
const FRAME_SHEETS = [
  ...files('features/branding/**/*.module.css'),
  'shared/view/CodeField/CodeField.module.css',
].filter((file) => !file.endsWith('PublicationBar.module.css'));

describe('the width at which the Branding pages narrow', () => {
  it('is 48rem, the number the hook asks about too', () => {
    expect(NARROW_REM).toBe(48);
  });

  it('finds the stylesheets by glob, and reads both spellings of a query', () => {
    expect(FRAME_SHEETS.length).toBeGreaterThan(8);
    expect(narrowWidths('@container workspace (inline-size < 40rem) { a {} }')).toEqual([40]);
    expect(narrowWidths('@container (width < 40rem) { a {} }')).toEqual([40]);
    expect(narrowWidths('@media (max-width: 40rem) { a {} }')).toEqual([40]);
    expect(narrowWidths('@container (inline-size >= 64rem) { a {} }')).toEqual([]);
  });

  it('is the one query of every stylesheet inside the editor’s frame', () => {
    expect(offenders(Object.fromEntries(FRAME_SHEETS.map((file) => [file, read(file)])))).toEqual(
      [],
    );
    for (const file of [
      'features/branding/view/PreviewFrame/PreviewFrame.module.css',
      'features/branding/view/Workspace/Workspace.module.css',
      'shared/view/CodeField/CodeField.module.css',
    ]) {
      expect(narrowWidths(read(file)).length, file).toBeGreaterThan(0);
    }
    expect(read('features/branding/view/Workspace/Workspace.tsx')).toContain(
      'data-narrow-container',
    );
    expect(read('features/branding/view/Workspace/Workspace.module.css')).toContain(
      'container: workspace / inline-size',
    );
  });

  it('fails for a new stylesheet that asks at another width', () => {
    const sheets = {
      'features/branding/view/New/New.module.css': '@container workspace (width < 40rem) { a {} }',
      'features/branding/view/Same/Same.module.css':
        '@container workspace (inline-size < 48rem) { a {} }',
    };
    expect(offenders(sheets)).toEqual(['features/branding/view/New/New.module.css']);
  });

  it('is the media query of what follows the screen and not the frame', () => {
    for (const file of ['shared/view/global.css', 'shared/view/Tabs/Tabs.module.css']) {
      const widths = narrowWidths(read(file));
      expect(widths.length, file).toBeGreaterThan(0);
      for (const width of widths) expect(width, file).toBe(NARROW_REM);
    }
  });

  it('folds the publication bar 50px of padding and borders later than the frame, so Revert is on one of the two', () => {
    const widths = narrowWidths(
      read('features/branding/view/PublicationBar/PublicationBar.module.css'),
    );
    expect(widths).toEqual([51.125]);
    expect((widths[0] ?? 0) * 16 - NARROW_REM * 16).toBe(50);
  });
});
