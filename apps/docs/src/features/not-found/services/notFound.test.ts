import { describe, expect, it } from 'vitest';
import { SECTIONS } from '@site/nav';
import { NOT_FOUND_ROUTES } from '@site/src/features/not-found/services/notFound';

describe('the routes a not-found page offers', () => {
  it('are documentation routes that exist', () => {
    const known = new Set(['/', ...SECTIONS.map((section) => `/${section.route}`)]);
    expect(
      NOT_FOUND_ROUTES.map((entry) => entry.route).filter((route) => !known.has(route)),
    ).toEqual([]);
  });

  it('start with the home and the quick start', () => {
    expect(NOT_FOUND_ROUTES.map((entry) => entry.id)).toEqual(['home', 'quick-start']);
  });
});
