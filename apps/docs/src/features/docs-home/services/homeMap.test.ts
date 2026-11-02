import { describe, expect, it } from 'vitest';
import { SECTIONS, START_ROUTES } from '@site/nav';
import { homeMapSections } from '@site/src/features/docs-home/services/homeMap';

describe('the home map sections', () => {
  it('splits the sections into where to start, the guides and everything else', () => {
    const { start, guides, deeper } = homeMapSections();
    expect(start.map(({ section }) => section.route)).toEqual(START_ROUTES);
    expect(guides.route).toBe('guides/');
    expect(deeper.some((section) => section === guides)).toBe(false);
    expect(start.length + deeper.length + 1).toBe(SECTIONS.length);
  });

  it('leads with the first place to begin and no other', () => {
    const { start } = homeMapSections();
    expect(start.map((card) => card.look)).toEqual([
      'primary',
      ...start.slice(1).map(() => 'plain'),
    ]);
  });
});
