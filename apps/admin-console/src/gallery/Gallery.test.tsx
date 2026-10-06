import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { expect, it } from 'vitest';
import { Gallery } from '#/gallery/Gallery.tsx';
import gallerySource from '#/gallery/Gallery.tsx?raw';

// Drawn by other components rather than used on their own: every dialog,
// every picker, a section's save handed to its notice whole, and the text only
// a screen reader gets.
const PARTS = new Set([
  'DialogFrame',
  'Picker',
  'SectionNoticeOf',
  'VisuallyHidden',
  'DataTable/DataTableShape',
]);

const modules = import.meta.glob<Record<string, unknown>>(
  ['../shared/view/*/*.tsx', '!../shared/view/*/*.test.tsx'],
  { eager: true },
);

const components = Object.entries(modules)
  .map(([file, exports]) => ({
    file: file.replace('../shared/view/', ''),
    names: Object.entries(exports)
      .filter(([name, value]) => /^[A-Z]/u.test(name) && typeof value === 'function')
      .map(([name]) => name),
  }))
  .filter(
    ({ file }) => !PARTS.has(file.split('/')[0] ?? '') && !PARTS.has(file.replace('.tsx', '')),
  );

// Every file's components, and a folder imported as one: some files hold
// several, and a file is shown when any one of its components is.
it('shows every component of the design system', () => {
  expect(components.length).toBeGreaterThan(20);
  const missing = components.flatMap(({ file, names }) => {
    const folder = file.split('/')[0] ?? '';
    const imported = gallerySource.includes(`from '#/shared/view/${folder}'`);
    const shown = (name: string): boolean => new RegExp(`\\b${name}\\b`, 'u').test(gallerySource);
    // The field components share a folder, so each of theirs is asked for by name.
    const family = folder === 'Field' && file !== 'Field/Field.tsx';
    const used = family ? names.every(shown) : names.some(shown);
    return imported && used ? [] : [file];
  });
  expect(missing).toEqual([]);
});

// One test per theme: the gallery grows with every component, and each
// component's own test already runs axe in both themes.
for (const theme of ['light', 'dark'] as const) {
  it(`renders as one page that passes axe in the ${theme} theme`, { timeout: 90_000 }, async () => {
    document.documentElement.dataset.theme = theme;
    const { unmount } = render(<Gallery theme={theme} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Instrument' })).toBeVisible();
    const result = await axe.run(document.body);
    expect(
      result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join('\n')}`),
    ).toEqual([]);
    unmount();
    delete document.documentElement.dataset.theme;
  });
}
