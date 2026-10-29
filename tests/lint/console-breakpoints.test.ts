import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '../../apps/admin-console/src');
const read = (file: string): string => readFileSync(path.join(SRC, file), 'utf8');

// A container query cannot read a custom property, so the one width at which
// the Branding pages narrow is written in each stylesheet that asks, and held
// to `NARROW_REM` here: change one, and this fails until they all agree.
const NARROW_REM = Number(
  /export const NARROW_REM = (\d+);/u.exec(read('shared/service/narrow.ts'))?.[1],
);

// Everything inside the editor's own frame, which is measured by `Workspace`.
const FRAME_QUERIES = [
  'features/branding/view/PreviewFrame/PreviewFrame.module.css',
  'features/branding/view/PreviewShell/PreviewShell.module.css',
  'features/branding/view/PreviewPane/PreviewPane.module.css',
  'features/branding/view/ThemeTab/ThemeTab.module.css',
  'features/branding/view/PagesTab/PagesTab.module.css',
  'features/branding/view/ColoursSection/ColoursSection.module.css',
  'shared/view/CodeField/CodeField.module.css',
];

describe('the width at which the Branding pages narrow', () => {
  it('is 48rem, the number the hook asks about too', () => {
    expect(NARROW_REM).toBe(48);
  });

  it('is the container query of each stylesheet inside the editor’s frame', () => {
    for (const file of FRAME_QUERIES) {
      const widths = [...read(file).matchAll(/@container \(inline-size < ([\d.]+)rem\)/gu)].map(
        (match) => Number(match[1]),
      );
      expect(widths.length, file).toBeGreaterThan(0);
      for (const width of widths) expect(width, file).toBe(NARROW_REM);
    }
    expect(read('features/branding/view/Workspace/Workspace.module.css')).toContain(
      `@container (inline-size < ${String(NARROW_REM)}rem)`,
    );
    expect(read('features/branding/view/Workspace/Workspace.tsx')).toContain(
      'data-narrow-container',
    );
  });

  it('is the media query of what follows the screen and not the frame', () => {
    for (const file of ['shared/view/global.css', 'shared/view/Tabs/Tabs.module.css']) {
      const widths = [...read(file).matchAll(/max-width: ([\d.]+)rem/gu)].map((match) =>
        Number(match[1]),
      );
      expect(widths.length, file).toBeGreaterThan(0);
      for (const width of widths) expect(width, file).toBe(NARROW_REM);
    }
  });

  it('folds the publication bar 50px of padding and borders later than the frame, so Revert is on one of the two', () => {
    const bar = read('features/branding/view/PublicationBar/PublicationBar.module.css');
    const widths = [...bar.matchAll(/@container \(inline-size < ([\d.]+)rem\)/gu)].map((match) =>
      Number(match[1]),
    );
    expect(widths).toEqual([51.125]);
    expect((widths[0] ?? 0) * 16 - NARROW_REM * 16).toBe(50);
  });
});
