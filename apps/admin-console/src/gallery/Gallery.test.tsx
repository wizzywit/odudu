import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { expect, it } from 'vitest';
import { Gallery } from '#/gallery/Gallery.tsx';
import gallerySource from '#/gallery/Gallery.tsx?raw';

// Drawn by every dialog rather than used on its own.
const PARTS = new Set(['DialogFrame']);

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

it('renders as one page that passes axe', async () => {
  render(<Gallery />);
  expect(screen.getByRole('heading', { level: 1, name: 'Instrument' })).toBeVisible();
  const result = await axe.run(document.body);
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join('\n')}`)).toEqual(
    [],
  );
});
