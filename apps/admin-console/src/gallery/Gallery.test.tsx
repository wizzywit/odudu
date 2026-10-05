import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { expect, it } from 'vitest';
import { Gallery } from '#/gallery/Gallery.tsx';
import gallerySource from '#/gallery/Gallery.tsx?raw';

// Drawn by other components rather than used on their own: every dialog,
// and every picker.
const PARTS = new Set(['DialogFrame', 'Picker']);

const components = Object.keys(
  import.meta.glob(['../shared/view/*.tsx', '!../shared/view/*.test.tsx']),
)
  .map((file) => file.replace('../shared/view/', '').replace('.tsx', ''))
  .filter((name) => !PARTS.has(name));

it('shows every component of the design system', () => {
  expect(components.length).toBeGreaterThan(20);
  const missing = components.filter(
    (name) => !gallerySource.includes(`from '#/shared/view/${name}.tsx'`),
  );
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
